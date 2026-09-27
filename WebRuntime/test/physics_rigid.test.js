import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRigidPhysics, eulerDegreesToQuaternion, quaternionToEulerDegrees,
  MAX_RIGID_FRAME_SECONDS} from '../src/physics_rigid.js';
import {createProceduralRecipe, generateProcedural} from '../src/procedural.js';

const vec = (x, y, z) => ({x, y, z});
const identity = {x: 0, y: 0, z: 0, w: 1};
const cube = (side = .4) => ({center: vec(0, side / 2, 0), size: vec(side, side, side)});
const floor = {objectId: 'floor', type: 'static', position: vec(0, -.1, 0),
  bounds: {center: vec(0, 0, 0), size: vec(20, .2, 20)}};
const box = (objectId, position) => ({objectId, type: 'dynamic', position, bounds: cube()});
const slopedDeck = () => ({partId: 'deck', positions: [
  -2, .2, -1, 2, 1.2, -1, 2, 1.2, 1, -2, .2, 1,
  -2, 0, -1, 2, 0, -1, 2, 0, 1, -2, 0, 1],
indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
  0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
  0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]});

async function withPhysics(run) {
  const physics = await createRigidPhysics();
  try {return await run(physics);}
  finally {physics.dispose();}
}

test('pure rotation helpers match Three XYZ degrees and preserve orientation', () => {
  for (const angles of [vec(0, 0, 0), vec(28, -42, 73), vec(90, 45, -120),
    vec(-180, 89.9, 135)]) {
    const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      ...['x', 'y', 'z'].map(axis => THREE.MathUtils.degToRad(angles[axis])), 'XYZ'));
    const actual = eulerDegreesToQuaternion(angles);
    assert.ok(Math.abs(Math.abs(expected.dot(new THREE.Quaternion(
      actual.x, actual.y, actual.z, actual.w))) - 1) < 1e-12);
    const again = eulerDegreesToQuaternion(quaternionToEulerDegrees(actual));
    const dot = Math.abs(actual.x * again.x + actual.y * again.y +
      actual.z * again.z + actual.w * again.w);
    assert.ok(Math.abs(dot - 1) < 1e-10);
  }
  assert.throws(() => eulerDegreesToQuaternion(vec(0, Infinity, 0)), /Euler/);
  assert.throws(() => quaternionToEulerDegrees({x: 0, y: 0, z: 0, w: 0}), /rotation/);
});

test('fixed ramp, floor, and two dynamic boxes produce real solver contacts', async () => {
  await withPhysics(physics => {
    physics.addBody(floor);
    physics.addBody({objectId: 'ramp', type: 'static', position: vec(0, .25, 0),
      rotation: {x: Math.sin(Math.PI / 12), y: 0, z: 0, w: Math.cos(Math.PI / 12)},
      bounds: {center: vec(0, 0, 0), size: vec(2, .12, 2)}});
    physics.addBody(box('lower', vec(0, 1.2, 0)));
    physics.addBody(box('upper', vec(0, 2.3, 0)));
    const contacts = [];
    for (let frame = 0; frame < 240; frame++) contacts.push(...physics.step(1 / 60).contacts);
    const pairs = contacts.filter(event => event.started).map(event =>
      new Set([event.objectIdA, event.objectIdB]));
    assert.ok(pairs.some(pair => pair.has('ramp') && pair.has('lower')),
      'lower box must strike the rotated ramp');
    assert.ok(pairs.some(pair => pair.has('lower') && pair.has('upper')),
      'the two simulated boxes must collide');
    for (const id of ['lower', 'upper']) {
      const state = physics.state(id);
      assert.ok(Number.isFinite(state.position.y));
      assert.ok(state.position.y > -.1, 'dynamic bodies remain above the floor');
    }
  });
});

test('a static procedural triangle mesh contacts at the true sloped heights', async () => {
  await withPhysics(physics => {
    physics.addBody({objectId: 'bridge', type: 'static', position: vec(0, 0, 0),
      bounds: {center: vec(0, .6, 0), size: vec(4, 1.2, 2)},
      meshes: [slopedDeck()]});
    for (const [id, x] of [['low', -1.5], ['high', 1.5]])
      physics.addBody({objectId: id, type: 'dynamic', position: vec(x, 3, 0),
        bounds: {center: vec(0, 0, 0), size: vec(.4, .4, .4)}});
    const firstContact = new Map();
    for (let frame = 0; frame < 120; frame++) {
      for (const event of physics.step(1 / 60).contacts) {
        if (!event.started) continue;
        const other = event.objectIdA === 'bridge' ? event.objectIdB :
          event.objectIdB === 'bridge' ? event.objectIdA : null;
        if (other && !firstContact.has(other)) {
          assert.ok(event.partIdA === 'deck' || event.partIdB === 'deck');
          firstContact.set(other, physics.state(other).position.y);
        }
      }
    }
    assert.ok(firstContact.has('low') && firstContact.has('high'));
    assert.ok(firstContact.get('high') - firstContact.get('low') > .5,
      'the high end must contact above the low end, unlike a box proxy');
    const saved = physics.snapshot();
    assert.deepEqual(saved.bodies.find(body => body.objectId === 'bridge').meshes,
      [slopedDeck()]);
    physics.restore(saved);
    assert.deepEqual(physics.snapshot(), saved);
  });
});

test('the registered bridge rise uses its generated deck mesh as the collider', async () => {
  await withPhysics(physics => {
    const generated = generateProcedural(createProceduralRecipe('bridge',
      {riseMeters: 1, railings: false, supports: false}));
    physics.addBody({objectId: 'bridge', type: 'static', position: vec(0, 0, 0),
      bounds: generated.localBounds,
      meshes: generated.parts.map(part => ({partId: part.partId,
        positions: part.geometry.positions, indices: part.geometry.indices}))});
    for (const [id, x] of [['low', -2], ['high', 2]])
      physics.addBody({objectId: id, type: 'dynamic', position: vec(x, 3.2, 0),
        bounds: {center: vec(0, 0, 0), size: vec(.3, .3, .3)}});
    const heights = new Map();
    for (let frame = 0; frame < 100 && heights.size < 2; frame++) {
      for (const contact of physics.step(1 / 60).contacts) {
        const id = contact.objectIdA === 'bridge' ? contact.objectIdB :
          contact.objectIdB === 'bridge' ? contact.objectIdA : null;
        if (contact.started && id && !heights.has(id))
          heights.set(id, physics.state(id).position.y);
      }
    }
    assert.ok(heights.has('low') && heights.has('high'));
    assert.ok(heights.get('high') - heights.get('low') > .5);
  });
});

test('malformed, oversized, and dynamic triangle meshes fail before solver allocation', async () => {
  await withPhysics(physics => {
    const staticDeck = {objectId: 'deck', type: 'static', position: vec(0, 0, 0),
      bounds: {center: vec(0, .6, 0), size: vec(4, 1.2, 2)},
      meshes: [slopedDeck()]};
    const invalidIndex = structuredClone(staticDeck);
    invalidIndex.meshes[0].indices[0] = 999;
    assert.throws(() => physics.addBody(invalidIndex), /mesh index/);
    const invalidVertex = structuredClone(staticDeck);
    invalidVertex.meshes[0].positions[0] = NaN;
    assert.throws(() => physics.addBody(invalidVertex), /vertex/);
    const oversized = structuredClone(staticDeck);
    oversized.meshes = Array.from({length: 33}, (_, index) =>
      ({...slopedDeck(), partId: `part-${index}`}));
    assert.throws(() => physics.addBody(oversized), /bounded static body/);
    const tooManyVertices = structuredClone(staticDeck);
    tooManyVertices.meshes[0].positions = Array(4097 * 3).fill(0);
    assert.throws(() => physics.addBody(tooManyVertices), /mesh budget/);
    const tooManyTriangles = structuredClone(staticDeck);
    tooManyTriangles.meshes[0].indices = Array(8193 * 3).fill(0);
    assert.throws(() => physics.addBody(tooManyTriangles), /mesh budget/);
    const nonfiniteIndex = structuredClone(staticDeck);
    nonfiniteIndex.meshes[0].indices[0] = Infinity;
    assert.throws(() => physics.addBody(nonfiniteIndex), /mesh index/);
    assert.throws(() => physics.addBody({...staticDeck, type: 'dynamic'}), /bounded static body/);
    assert.equal(physics.states().length, 0);
    physics.addBody(staticDeck);
    const saved = physics.snapshot();
    const corrupt = structuredClone(saved);
    corrupt.bodies[0].meshes[0].indices[0] = -1;
    assert.throws(() => physics.restore(corrupt), /mesh index/);
    assert.deepEqual(physics.snapshot(), saved,
      'invalid restore leaves the old mesh body and world untouched');
  });
});

test('repeated grab, move, and release resumes gravity from each hand pose', async () => {
  await withPhysics(physics => {
    physics.addBody(floor);
    physics.addBody(box('held', vec(0, 1, 0)));
    for (let frame = 0; frame < 20; frame++) physics.step(1 / 60);
    for (const x of [1, 2]) {
      assert.equal(physics.beginGrab('held'), true);
      assert.equal(physics.beginGrab('held'), false);
      physics.moveGrab('held', {position: vec(x, 2, 0), rotation: identity});
      for (let frame = 0; frame < 5; frame++) physics.step(1 / 60);
      assert.equal(physics.state('held').held, true);
      assert.ok(Math.abs(physics.state('held').position.x - x) < .01);
      assert.ok(Math.abs(physics.state('held').position.y - 2) < .01);
      const released = physics.releaseGrab('held');
      assert.equal(released.held, false);
      assert.ok(Math.abs(released.position.x - x) < .01);
      for (let frame = 0; frame < 15; frame++) physics.step(1 / 60);
      assert.ok(physics.state('held').position.y < 2 - .2,
        'the body must fall again after release');
    }
  });
});

test('static sensor exposes both object IDs without blocking the falling box', async () => {
  await withPhysics(physics => {
    physics.addBody(floor);
    physics.addBody({objectId: 'receptacle', type: 'static', sensor: true,
      position: vec(0, .65, 0),
      bounds: {center: vec(0, 0, 0), size: vec(1, .2, 1)}});
    physics.addBody(box('token', vec(0, 1.5, 0)));
    const contacts = [];
    for (let frame = 0; frame < 120; frame++) contacts.push(...physics.step(1 / 60).contacts);
    assert.ok(contacts.some(event => event.started &&
      new Set([event.objectIdA, event.objectIdB]).has('receptacle')));
    assert.ok(Math.abs(physics.state('token').position.y) < .02,
      'sensor did not turn into a supporting surface');
  });
});

test('snapshot restores identity, pose, velocity, gravity, and rejects bad state atomically', async () => {
  await withPhysics(physics => {
    physics.addBody(floor);
    physics.addBody({...box('moving', vec(0, 1, 0)), linearVelocity: vec(1, 0, 0)});
    for (let frame = 0; frame < 10; frame++) physics.step(1 / 60);
    physics.setGravity(vec(0, -3, 0));
    const saved = physics.snapshot();
    const savedState = physics.state('moving');
    physics.setPose('moving', {position: vec(5, 3, 0), rotation: identity});
    assert.throws(() => physics.restore({...saved, bodies: [...saved.bodies, saved.bodies[1]]}),
      /Duplicate rigid snapshot object ID/);
    assert.ok(physics.state('moving').position.x > 4);
    physics.restore(saved);
    assert.deepEqual(physics.snapshot(), saved);
    assert.ok(Math.abs(physics.state('moving').position.x - savedState.position.x) < .001);
    assert.ok(physics.step(1 / 60).states.find(state => state.objectId === 'moving')
      .position.x > savedState.position.x);
  });
});

test('invalid bodies and long frame times leave the bounded world usable', async () => {
  await withPhysics(physics => {
    assert.throws(() => physics.addBody({...box('bad', vec(0, 1, 0)),
      bounds: {center: vec(0, 0, 0), size: vec(-1, 1, 1)}}), /collider/);
    assert.equal(physics.states().length, 0);
    physics.addBody(box('ok', vec(0, 1, 0)));
    assert.throws(() => physics.addBody(box('ok', vec(0, 1, 0))), /already exists/);
    assert.throws(() => physics.setGravity(vec(0, -100, 0)), /gravity/);
    assert.throws(() => physics.step(-1), /frame duration/);
    const result = physics.step(10);
    assert.ok(result.steps <= MAX_RIGID_FRAME_SECONDS * 60 + 1e-9);
    assert.equal(result.states.length, 1);
    assert.equal(physics.removeBody('ok'), true);
    assert.equal(physics.removeBody('ok'), false);
  });
});
