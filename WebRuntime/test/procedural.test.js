import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROCEDURAL_BUDGET, createProceduralRegistry, listProceduralGenerators,
  createProceduralRecipe, normalizeProceduralRecipe, reviseProceduralRecipe,
  generateProcedural, validateProceduralOutput
} from '../src/procedural.js';

test('discovery exposes bounded versioned recipes without executable code', () => {
  const listed = listProceduralGenerators();
  assert.deepEqual(listed.map(item => item.generatorId), ['bridge', 'curved-bench']);
  assert.equal(listed[0].parameterSchema.lengthMeters.default, 6);
  listed[0].parameterSchema.lengthMeters.default = 100;
  assert.equal(listProceduralGenerators()[0].parameterSchema.lengthMeters.default, 6);
  const recipe = createProceduralRecipe('bridge');
  assert.deepEqual(Object.keys(recipe).sort(), [
    'dependencies', 'generatorId', 'generatorVersion', 'parameters',
    'schemaVersion', 'seed', 'sourceRevision'
  ]);
  assert.equal(recipe.generatorVersion, '1.0.0');
  assert.equal(recipe.sourceRevision, 'bridge-v1');
  assert.deepEqual(recipe.dependencies, []);
  assert.equal(JSON.stringify(recipe).includes('function'), false);
  assert.deepEqual(normalizeProceduralRecipe(recipe), recipe);
});

test('bridge edits regenerate a sloped deck with stable semantic parts and independent recipes', () => {
  const original = createProceduralRecipe('bridge', {railings: false, supports: false});
  const first = generateProcedural(original);
  const revised = reviseProceduralRecipe(original, {
    lengthMeters: 9, widthMeters: 2, deckHeightMeters: .7,
    riseMeters: 1, supports: true
  });
  const second = generateProcedural(revised);
  assert.deepEqual(first.parts.map(item => item.partId), ['deck']);
  assert.deepEqual(second.parts.map(item => item.partId), [
    'deck', 'support-front-left', 'support-front-right',
    'support-back-left', 'support-back-right'
  ]);
  assert.equal(first.localBounds.size.x, 6);
  assert.equal(second.localBounds.size.x, 9);
  assert.equal(second.localBounds.size.z, 2);
  const yValues = new Set(second.parts[0].geometry.positions.filter((_, i) => i % 3 === 1));
  assert.equal([...yValues].some(value => Math.abs(value - .2) < 1e-9), true);
  assert.equal([...yValues].some(value => Math.abs(value - 1.2) < 1e-9), true);
  assert.equal(original.parameters.lengthMeters, 6);
  assert.equal(original.parameters.riseMeters, 0);
  assert.deepEqual(generateProcedural(revised), second);
  assert.equal(validateProceduralOutput(second), true);
});

test('curved bench has a true swept mesh and independently editable instances', () => {
  const firstRecipe = createProceduralRecipe('curved-bench');
  const secondRecipe = createProceduralRecipe('curved-bench', {
    lengthMeters: 2.5, arcDegrees: 110
  });
  const first = generateProcedural(firstRecipe);
  const second = generateProcedural(secondRecipe);
  assert.deepEqual(first.parts.map(item => item.partId),
    ['seat', 'back', 'leg-left', 'leg-right']);
  const seatPositions = first.parts[0].geometry.positions;
  assert.ok(seatPositions.length / 3 > 100);
  const seatZ = new Set(seatPositions.filter((_, i) => i % 3 === 2)
    .map(value => value.toFixed(4)));
  assert.ok(seatZ.size > 12, 'seat must sweep through curved X/Z positions');
  assert.notEqual(first.localBounds.size.x, second.localBounds.size.x);
  assert.deepEqual(firstRecipe.parameters, createProceduralRecipe('curved-bench').parameters);
  assert.ok(first.budget.bufferBytes < PROCEDURAL_BUDGET.bufferBytes);
  assert.equal(validateProceduralOutput(first), true);
});

test('invalid edits, stale versions and tampered output fail without altering the prior result', () => {
  const recipe = createProceduralRecipe('bridge');
  const old = generateProcedural(recipe);
  for (const patch of [
    {widthMeters: Infinity}, {widthMeters: 20}, {unknown: 1},
    {railings: 'yes'}, {riseMeters: NaN}
  ]) assert.throws(() => reviseProceduralRecipe(recipe, patch));
  assert.throws(() => generateProcedural(createProceduralRecipe('bridge', {
    deckHeightMeters: .2, riseMeters: 1
  })), /below the virtual floor/);
  for (const change of [
    {generatorVersion: '2.0.0'}, {sourceRevision: 'bridge-v2'},
    {dependencies: [{resourceId: 'unknown'}]}
  ]) assert.throws(() => normalizeProceduralRecipe({...recipe, ...change}),
    /version or dependency unavailable/);
  assert.throws(() => normalizeProceduralRecipe({...recipe,
    parameters: {...recipe.parameters, unexpected: true}}), /Unknown procedural parameter/);
  const tampered = structuredClone(old);
  tampered.parts[0].geometry.positions[0] = Infinity;
  assert.throws(() => validateProceduralOutput(tampered), /vertex/);
  assert.deepEqual(generateProcedural(recipe), old);
});

test('reviewed new generator uses the generic registry and budget is checked before build', () => {
  const mesh = {positions: [0, 0, 0, 1, 0, 0, 0, 1, 1], indices: [0, 1, 2]};
  const good = {generatorId: 'triangle', generatorVersion: '1.0.0',
    sourceRevision: 'triangle-v1', description: 'A test generator', dependencies: [],
    parameterSchema: {sizeMeters: {type: 'number', default: 1, min: .1, max: 2}},
    estimate: () => ({parts: 1, vertices: 3, triangles: 1, bufferBytes: 48}),
    build: p => ({parts: [{partId: 'surface',
      geometry: {...mesh, positions: mesh.positions.map(value => value * p.sizeMeters)},
      material: {color: '#ffffff', roughness: .8, metalness: 0},
      collision: {kind: 'static-trimesh'}}]})};
  const registry = createProceduralRegistry([good]);
  const recipe = registry.createRecipe('triangle', {sizeMeters: 1.5});
  const output = registry.generate(recipe);
  assert.equal(output.localBounds.size.x, 1.5);
  assert.equal(validateProceduralOutput(output, registry.normalizeRecipe), true);
  let built = false;
  const oversized = {...good, generatorId: 'oversized', sourceRevision: 'oversized-v1',
    estimate: () => ({parts: PROCEDURAL_BUDGET.parts + 1,
      vertices: 3, triangles: 1, bufferBytes: 48}),
    build: () => {built = true; return good.build({sizeMeters: 1});}};
  const oversizedRegistry = createProceduralRegistry([oversized]);
  assert.throws(() => oversizedRegistry.generate(oversizedRegistry.createRecipe('oversized')),
    /parts budget exceeded/);
  assert.equal(built, false);
});
