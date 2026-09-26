// A bounded Rapier adapter for Matrix root objects. Scene objects own the
// authored recipe; this module owns simulated poses and contact observations.
import RAPIER from '@dimforge/rapier3d-compat';

export const RIGID_STEP_SECONDS = 1 / 60;
export const MAX_RIGID_FRAME_SECONDS = .1;
export const MAX_RIGID_BODIES = 100;
export const MAX_RIGID_MESH_PARTS = 32;
export const MAX_RIGID_MESH_VERTICES = 4096;
export const MAX_RIGID_MESH_TRIANGLES = 8192;
export const MAX_RIGID_MESH_BYTES = 131072;
export const RIGID_FLOOR_ID = '__matrix_floor__';
const MAX_CONTACT_EVENTS = 256;
const ZERO = Object.freeze({x: 0, y: 0, z: 0});
const IDENTITY = Object.freeze({x: 0, y: 0, z: 0, w: 1});
let initialization;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const near = (left, right) => finite(left) && Math.abs(left - right) < .0001;
const vector = value => value && ['x', 'y', 'z'].every(axis => finite(value[axis]));
const quaternion = value => value && ['x', 'y', 'z', 'w'].every(axis => finite(value[axis])) &&
  Math.abs(Math.hypot(value.x, value.y, value.z, value.w) - 1) < .001;
const copyVector = value => ({x: value.x, y: value.y, z: value.z});
const copyQuaternion = value => ({x: value.x, y: value.y, z: value.z, w: value.w});

// Matrix scene rotations are degrees in Three.js's XYZ Euler order. Keep the
// conversion here so MatrixWorld does not need a renderer dependency.
export function eulerDegreesToQuaternion(euler) {
  if (!vector(euler) || ['x', 'y', 'z'].some(axis => Math.abs(euler[axis]) > 36000))
    throw Error('Invalid Matrix Euler rotation');
  const x = euler.x * Math.PI / 360, y = euler.y * Math.PI / 360,
    z = euler.z * Math.PI / 360;
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
  const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return {x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3};
}

export function quaternionToEulerDegrees(rotation) {
  if (!quaternion(rotation)) throw Error('Invalid rigid body rotation');
  const {x, y, z, w} = rotation;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const clamped = Math.max(-1, Math.min(1, m13));
  const ey = Math.asin(clamped);
  const ex = Math.abs(m13) < .9999999 ? Math.atan2(-m23, m33) : Math.atan2(m32, m22);
  const ez = Math.abs(m13) < .9999999 ? Math.atan2(-m12, m11) : 0;
  const degrees = 180 / Math.PI;
  return {x: ex * degrees, y: ey * degrees, z: ez * degrees};
}

function checkedGravity(value) {
  if (!vector(value) || Math.hypot(value.x, value.y, value.z) > 30)
    throw Error('Rigid gravity must be finite and at most 30 m/s²');
  return copyVector(value);
}

function checkedMeshes(meshes, type, bounds) {
  if (meshes === undefined) return null;
  if (type !== 'static' || !Array.isArray(meshes) ||
      meshes.length < 1 || meshes.length > MAX_RIGID_MESH_PARTS)
    throw Error('Rigid triangle meshes require a bounded static body');
  const partIds = new Set();
  let vertices = 0, triangles = 0, bytes = 0;
  for (const mesh of meshes) {
    if (!mesh || typeof mesh !== 'object' || Array.isArray(mesh) ||
        typeof mesh.partId !== 'string' ||
        !/^[a-z][a-z0-9-]{0,47}$/.test(mesh.partId) || partIds.has(mesh.partId) ||
        !Array.isArray(mesh.positions) || mesh.positions.length < 9 ||
        mesh.positions.length % 3 !== 0 ||
        !Array.isArray(mesh.indices) || mesh.indices.length < 3 ||
        mesh.indices.length % 3 !== 0)
      throw Error('Invalid rigid triangle mesh part');
    partIds.add(mesh.partId);
    vertices += mesh.positions.length / 3;
    triangles += mesh.indices.length / 3;
    bytes += (mesh.positions.length + mesh.indices.length) * 4;
    if (vertices > MAX_RIGID_MESH_VERTICES || triangles > MAX_RIGID_MESH_TRIANGLES ||
        bytes > MAX_RIGID_MESH_BYTES)
      throw Error('Rigid triangle mesh budget exceeded');
    const count = mesh.positions.length / 3;
    for (let index = 0; index < mesh.positions.length; index++) {
      const coordinate = mesh.positions[index], axis = ['x', 'y', 'z'][index % 3];
      if (!finite(coordinate) || Math.abs(coordinate) > 20 ||
          coordinate < bounds.center[axis] - bounds.size[axis] / 2 - .001 ||
          coordinate > bounds.center[axis] + bounds.size[axis] / 2 + .001)
        throw Error('Rigid triangle mesh vertex is nonfinite or outside measured bounds');
    }
    for (const index of mesh.indices) if (!Number.isSafeInteger(index) ||
        index < 0 || index >= count)
      throw Error('Invalid rigid triangle mesh index');
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const a = mesh.indices[index], b = mesh.indices[index + 1], c = mesh.indices[index + 2];
      if (a === b || b === c || a === c)
        throw Error('Degenerate rigid triangle mesh face');
      const ax = mesh.positions[a * 3], ay = mesh.positions[a * 3 + 1], az = mesh.positions[a * 3 + 2];
      const bx = mesh.positions[b * 3] - ax, by = mesh.positions[b * 3 + 1] - ay,
        bz = mesh.positions[b * 3 + 2] - az;
      const cx = mesh.positions[c * 3] - ax, cy = mesh.positions[c * 3 + 1] - ay,
        cz = mesh.positions[c * 3 + 2] - az;
      if (Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx) < 1e-9)
        throw Error('Degenerate rigid triangle mesh face');
    }
  }
  // All parts have passed validation before any typed-array or WASM allocation.
  return meshes.map(mesh => ({partId: mesh.partId,
    positions: [...mesh.positions], indices: [...mesh.indices]}));
}

function checkedBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.objectId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(value.objectId))
    throw Error('Invalid rigid object ID');
  const type = value.type === 'fixed' ? 'static' : value.type;
  if (!['static', 'dynamic'].includes(type)) throw Error('Invalid rigid body type');
  if (!vector(value.position) || !['x', 'y', 'z'].every(axis => Math.abs(value.position[axis]) <= 100))
    throw Error('Invalid rigid body position');
  const rotation = value.rotation ?? IDENTITY;
  if (!quaternion(rotation)) throw Error('Invalid rigid body rotation');
  const bounds = value.bounds;
  const virtualFloor = value.objectId === RIGID_FLOOR_ID;
  if (!bounds || !vector(bounds.center) || !vector(bounds.size) ||
      !['x', 'y', 'z'].every(axis => bounds.size[axis] >= .001 &&
        bounds.size[axis] <= (virtualFloor && axis !== 'y' ? 200 : 20) &&
        Math.abs(bounds.center[axis]) <= 20))
    throw Error('Rigid collider needs finite local center and size');
  if (virtualFloor && (type !== 'static' || !near(value.position.x, 0) ||
      !near(value.position.y, -.06) || !near(value.position.z, 0) ||
      !near(rotation.x, 0) || !near(rotation.y, 0) || !near(rotation.z, 0) ||
      !near(rotation.w, 1) || !near(bounds.center.x, 0) ||
      !near(bounds.center.y, 0) || !near(bounds.center.z, 0) ||
      !near(bounds.size.x, 200) || !near(bounds.size.y, .12) ||
      !near(bounds.size.z, 200) ||
      value.meshes !== undefined))
    throw Error('Reserved virtual floor must use its exact internal collider');
  const restitution = value.restitution ?? 0;
  const friction = value.friction ?? .7;
  if (!finite(restitution) || restitution < 0 || restitution > 1 ||
      !finite(friction) || friction < 0 || friction > 2)
    throw Error('Invalid rigid collider material');
  const sensor = value.sensor ?? false;
  if (typeof sensor !== 'boolean' || sensor && (type !== 'static' || virtualFloor))
    throw Error('Only static rigid colliders may be sensors');
  const linearVelocity = value.linearVelocity ?? ZERO;
  const angularVelocity = value.angularVelocity ?? ZERO;
  if (!vector(linearVelocity) || !vector(angularVelocity) ||
      [...Object.values(linearVelocity), ...Object.values(angularVelocity)]
        .some(number => Math.abs(number) > 100) ||
      type === 'static' && (Object.values(linearVelocity).some(Boolean) ||
        Object.values(angularVelocity).some(Boolean)))
    throw Error('Invalid rigid body velocity');
  const meshes = checkedMeshes(value.meshes, type, bounds);
  return {objectId: value.objectId, type, position: copyVector(value.position),
    rotation: copyQuaternion(rotation),
    bounds: {center: copyVector(bounds.center), size: copyVector(bounds.size)},
    restitution, friction, sensor,
    linearVelocity: copyVector(linearVelocity), angularVelocity: copyVector(angularVelocity),
    ...(meshes ? {meshes} : {})};
}

export async function createRigidPhysics({gravity = {x: 0, y: -9.81, z: 0}} = {}) {
  const checked = checkedGravity(gravity);
  initialization ??= RAPIER.init();
  await initialization;
  return new RigidPhysics(checked);
}

export class RigidPhysics {
  // Call createRigidPhysics so the bundled WASM has initialized first.
  constructor(gravity = {x: 0, y: -9.81, z: 0}) {
    this.world = new RAPIER.World(checkedGravity(gravity));
    this.world.timestep = RIGID_STEP_SECONDS;
    this.events = new RAPIER.EventQueue(true);
    this.bodies = new Map();
    this.colliderIds = new Map();
    this.accumulatorSeconds = 0;
    this.disposed = false;
  }

  assertReady() {
    if (this.disposed) throw Error('Rigid physics world is disposed');
  }

  setGravity(value) {
    this.assertReady();
    this.world.gravity = checkedGravity(value);
  }

  addBody(value) {
    this.assertReady();
    const config = checkedBody(value);
    if (this.bodies.has(config.objectId)) throw Error('Rigid object ID already exists');
    if (this.bodies.size >= MAX_RIGID_BODIES) throw Error('Rigid body limit reached');
    const {position, rotation, bounds} = config;
    const bodyDesc = (config.type === 'dynamic' ? RAPIER.RigidBodyDesc.dynamic() :
      RAPIER.RigidBodyDesc.fixed())
      .setTranslation(position.x, position.y, position.z).setRotation(rotation);
    if (config.type === 'dynamic') {
      bodyDesc.setLinvel(config.linearVelocity.x, config.linearVelocity.y,
        config.linearVelocity.z).setAngvel(config.angularVelocity).setCcdEnabled(true);
    }
    const body = this.world.createRigidBody(bodyDesc);
    try {
      const parts = config.meshes ?? [null];
      const colliders = [];
      for (const part of parts) {
        const colliderDesc = (part ? RAPIER.ColliderDesc.trimesh(
          new Float32Array(part.positions), new Uint32Array(part.indices),
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES) :
          RAPIER.ColliderDesc.cuboid(bounds.size.x / 2,
            bounds.size.y / 2, bounds.size.z / 2)
            .setTranslation(bounds.center.x, bounds.center.y, bounds.center.z))
          .setRestitution(config.restitution).setFriction(config.friction)
          .setSensor(config.sensor).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, body);
        colliders.push(collider);
      }
      this.bodies.set(config.objectId, {body, colliders, config, held: false, heldTarget: null});
      for (let index = 0; index < colliders.length; index++)
        this.colliderIds.set(colliders[index].handle,
          {objectId: config.objectId, partId: parts[index]?.partId ?? null});
      return this.state(config.objectId);
    } catch (error) {
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  removeBody(objectId) {
    this.assertReady();
    const entry = this.bodies.get(objectId);
    if (!entry) return false;
    for (const collider of entry.colliders) this.colliderIds.delete(collider.handle);
    this.world.removeRigidBody(entry.body);
    this.bodies.delete(objectId);
    return true;
  }

  requireBody(objectId) {
    this.assertReady();
    const entry = this.bodies.get(objectId);
    if (!entry) throw Error('Unknown rigid object ID');
    return entry;
  }

  state(objectId) {
    const entry = this.requireBody(objectId);
    const {body, config, held, heldTarget} = entry;
    return {objectId, type: config.type, held,
      position: copyVector(heldTarget?.position ?? body.translation()),
      rotation: copyQuaternion(heldTarget?.rotation ?? body.rotation()),
      linearVelocity: copyVector(body.linvel()),
      angularVelocity: copyVector(body.angvel()), sleeping: body.isSleeping()};
  }

  states() {
    this.assertReady();
    return [...this.bodies.keys()].map(id => this.state(id));
  }

  beginGrab(objectId) {
    const entry = this.requireBody(objectId);
    if (entry.config.type !== 'dynamic' || entry.held) return false;
    entry.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    entry.body.setLinvel(ZERO, true);
    entry.body.setAngvel(ZERO, true);
    entry.held = true;
    entry.heldTarget = {position: copyVector(entry.body.translation()),
      rotation: copyQuaternion(entry.body.rotation())};
    return true;
  }

  moveGrab(objectId, {position, rotation} = {}) {
    const entry = this.requireBody(objectId);
    if (!entry.held) throw Error('Rigid object is not grabbed');
    if (!vector(position) || !['x', 'y', 'z'].every(axis => Math.abs(position[axis]) <= 100) ||
        !quaternion(rotation)) throw Error('Invalid grabbed pose');
    entry.heldTarget = {position: copyVector(position), rotation: copyQuaternion(rotation)};
    entry.body.setNextKinematicTranslation(position);
    entry.body.setNextKinematicRotation(rotation);
    return this.state(objectId);
  }

  releaseGrab(objectId) {
    const entry = this.requireBody(objectId);
    if (!entry.held) return false;
    // The last controller pose may arrive between fixed steps. Commit it before
    // switching back to dynamics so release never snaps to an older pose.
    entry.body.setTranslation(entry.heldTarget.position, true);
    entry.body.setRotation(entry.heldTarget.rotation, true);
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    entry.body.setLinvel(ZERO, true);
    entry.body.setAngvel(ZERO, true);
    entry.held = false;
    entry.heldTarget = null;
    return this.state(objectId);
  }

  setPose(objectId, {position, rotation}, {resetVelocity = true} = {}) {
    const entry = this.requireBody(objectId);
    if (entry.held) throw Error('Release rigid object before changing its authored pose');
    if (!vector(position) || !['x', 'y', 'z'].every(axis => Math.abs(position[axis]) <= 100) ||
        !quaternion(rotation)) throw Error('Invalid rigid body pose');
    entry.body.setTranslation(position, true);
    entry.body.setRotation(rotation, true);
    if (resetVelocity && entry.config.type === 'dynamic') {
      entry.body.setLinvel(ZERO, true);
      entry.body.setAngvel(ZERO, true);
    }
    return this.state(objectId);
  }

  step(deltaSeconds) {
    this.assertReady();
    if (!finite(deltaSeconds) || deltaSeconds < 0) throw Error('Invalid rigid frame duration');
    this.accumulatorSeconds = Math.min(MAX_RIGID_FRAME_SECONDS,
      this.accumulatorSeconds + Math.min(deltaSeconds, MAX_RIGID_FRAME_SECONDS));
    const contacts = [];
    let steps = 0, truncatedContacts = false;
    while (this.accumulatorSeconds + 1e-10 >= RIGID_STEP_SECONDS && steps < 6) {
      this.accumulatorSeconds -= RIGID_STEP_SECONDS;
      if (this.accumulatorSeconds < 0) this.accumulatorSeconds = 0;
      for (const entry of this.bodies.values()) if (entry.held && entry.heldTarget) {
        entry.body.setNextKinematicTranslation(entry.heldTarget.position);
        entry.body.setNextKinematicRotation(entry.heldTarget.rotation);
      }
      this.world.step(this.events);
      this.events.drainCollisionEvents((a, b, started) => {
        const first = this.colliderIds.get(a), second = this.colliderIds.get(b);
        if (!first || !second || first.objectId === second.objectId) return;
        if (contacts.length >= MAX_CONTACT_EVENTS) {truncatedContacts = true; return;}
        contacts.push({objectIdA: first.objectId, objectIdB: second.objectId,
          ...(first.partId ? {partIdA: first.partId} : {}),
          ...(second.partId ? {partIdB: second.partId} : {}), started});
      });
      steps++;
    }
    return {steps, contacts, truncatedContacts, states: this.states()};
  }

  snapshot() {
    this.assertReady();
    return {schemaVersion: 1, gravity: copyVector(this.world.gravity),
      bodies: [...this.bodies.values()].map(entry => ({...structuredClone(entry.config),
        position: copyVector(entry.heldTarget?.position ?? entry.body.translation()),
        rotation: copyQuaternion(entry.heldTarget?.rotation ?? entry.body.rotation()),
        linearVelocity: entry.held ? copyVector(ZERO) : copyVector(entry.body.linvel()),
        angularVelocity: entry.held ? copyVector(ZERO) : copyVector(entry.body.angvel())}))};
  }

  restore(snapshot) {
    this.assertReady();
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.bodies) ||
        snapshot.bodies.length > MAX_RIGID_BODIES)
      throw Error('Invalid rigid snapshot');
    const gravity = checkedGravity(snapshot.gravity);
    const checked = snapshot.bodies.map(checkedBody);
    if (new Set(checked.map(body => body.objectId)).size !== checked.length)
      throw Error('Duplicate rigid snapshot object ID');
    // Stage in a fresh solver. An invalid snapshot cannot disturb the last
    // good world, and freeing the old solver releases its WASM allocations.
    const staged = new RigidPhysics(gravity);
    try {
      for (const body of checked) staged.addBody(body);
    } catch (error) {
      staged.dispose();
      throw error;
    }
    const oldWorld = this.world, oldEvents = this.events;
    this.world = staged.world; this.events = staged.events;
    this.bodies = staged.bodies; this.colliderIds = staged.colliderIds;
    this.accumulatorSeconds = 0;
    staged.disposed = true;
    oldEvents.free(); oldWorld.free();
    return this.states();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.bodies.clear(); this.colliderIds.clear();
    this.events.free(); this.world.free();
  }
}
