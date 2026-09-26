// Bounded, virtual-floor-only dynamics. The scene owns the authored transform;
// this solver owns only a transient vertical pose and velocity.
export const PHYSICS_STEP_SECONDS = 1 / 60;
export const PHYSICS_GRAVITY_MPS2 = 9.81;
export const MAX_PHYSICS_FRAME_SECONDS = .1;
const SETTLE_SPEED_MPS = .08;
const MAX_CONTACTS = 1000;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validPhysicsConfig(value) {
  return exact(value, ['schemaVersion', 'kind', 'collider', 'restitution']) &&
    value.schemaVersion === 1 && value.kind === 'gravity-floor' &&
    value.collider === 'catalog-bounds-box' && finite(value.restitution) &&
    value.restitution >= 0 && value.restitution <= .75;
}

export function physicsFloorY(asset, transform) {
  const bounds = asset?.localBounds;
  if (!bounds || !finite(bounds.center?.y) || !finite(bounds.size?.y) || bounds.size.y <= 0 ||
      !finite(asset.spawnScale) || !finite(transform?.scale?.y))
    throw Error('Physics needs measured catalog bounds');
  // loadExternal() floor-aligns every GLB before adding it under the object
  // root, so the rendered box bottom is root-local Y=0 regardless of export pivot.
  return 0;
}

export function createFloorBody(object, asset, executionId) {
  const floorY = physicsFloorY(asset, object.transform);
  const position = structuredClone(object.transform.position);
  position.y = Math.max(position.y, floorY);
  return {objectId: object.objectId, executionId, status: 'falling', position,
    verticalVelocityMps: 0, contactCount: 0, lastContact: null,
    floorY, restitution: object.physics.restitution, accumulatorSeconds: 0,
    authoredTransform: structuredClone(object.transform), assetId: object.assetId,
    anchorId: object.anchorId, physics: structuredClone(object.physics)};
}

export function publicPhysicsState(body) {
  return {objectId: body.objectId, executionId: body.executionId, status: body.status,
    position: structuredClone(body.position), verticalVelocityMps: body.verticalVelocityMps,
    contactCount: body.contactCount, lastContact: body.lastContact && structuredClone(body.lastContact)};
}

export function advanceFloorBody(source, deltaSeconds) {
  if (!finite(deltaSeconds) || deltaSeconds < 0) throw Error('Invalid physics frame duration');
  const body = structuredClone(source), contacts = [];
  if (body.status !== 'falling') return {body, contacts};
  body.accumulatorSeconds = Math.min(MAX_PHYSICS_FRAME_SECONDS,
    body.accumulatorSeconds + Math.min(deltaSeconds, MAX_PHYSICS_FRAME_SECONDS));
  let steps = 0;
  while (body.accumulatorSeconds + 1e-10 >= PHYSICS_STEP_SECONDS && steps++ < 6 &&
         body.status === 'falling') {
    body.accumulatorSeconds -= PHYSICS_STEP_SECONDS;
    if (body.accumulatorSeconds < 0) body.accumulatorSeconds = 0;
    let remaining = PHYSICS_STEP_SECONDS, impacts = 0;
    while (remaining > 1e-10 && body.status === 'falling') {
      const startY = body.position.y, startVelocity = body.verticalVelocityMps;
      const nextY = startY + startVelocity * remaining -
        .5 * PHYSICS_GRAVITY_MPS2 * remaining ** 2;
      if (nextY > body.floorY) {
        body.position.y = nextY;
        body.verticalVelocityMps = Math.max(-50, startVelocity - PHYSICS_GRAVITY_MPS2 * remaining);
        break;
      }
      // Resolve exact plane crossing within the fixed step, then integrate
      // any remaining substep after the rebound.
      const distance = Math.max(0, startY - body.floorY);
      const impactTime = Math.min(remaining,
        (startVelocity + Math.sqrt(startVelocity ** 2 + 2 * PHYSICS_GRAVITY_MPS2 * distance)) /
        PHYSICS_GRAVITY_MPS2);
      const impactSpeed = Math.min(50, Math.max(0,
        PHYSICS_GRAVITY_MPS2 * impactTime - startVelocity));
      body.position.y = body.floorY;
      body.contactCount = Math.min(MAX_CONTACTS, body.contactCount + 1);
      body.lastContact = {index: body.contactCount, surface: 'web-floor',
        impactSpeedMps: Number(impactSpeed.toFixed(4)), approximate: true};
      const rebound = impactSpeed * body.restitution;
      remaining -= impactTime;
      if (rebound < SETTLE_SPEED_MPS || body.contactCount >= MAX_CONTACTS || ++impacts >= 8) {
        body.status = 'settled';
        body.verticalVelocityMps = 0;
        body.accumulatorSeconds = 0;
      } else body.verticalVelocityMps = rebound;
      contacts.push(publicPhysicsState(body));
    }
  }
  return {body, contacts};
}
