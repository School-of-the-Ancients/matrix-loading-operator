// Reviewed source modules register generators here. A saved recipe contains data,
// never executable code; changing a generator requires the normal code/build path.
export const PROCEDURAL_SCHEMA_VERSION = 1;
export const PROCEDURAL_BUDGET = Object.freeze({
  parts: 32, vertices: 4096, triangles: 8192, bufferBytes: 131072
});

const clone = value => structuredClone(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const parameterNamePattern = /^[a-z][a-zA-Z0-9]{0,47}$/;
const versionPattern = /^[1-9]\d*\.[0-9]+\.[0-9]+$/;
const exactKeys = (value, keys) => record(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

function assertBudget(value) {
  if (!exactKeys(value, ['parts', 'vertices', 'triangles', 'bufferBytes']))
    throw Error('Invalid procedural budget estimate');
  for (const [key, maximum] of Object.entries(PROCEDURAL_BUDGET)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0)
      throw Error(`Invalid procedural ${key} estimate`);
    if (value[key] > maximum) throw Error(`Procedural ${key} budget exceeded`);
  }
  return value;
}

function parameterSchema(definition) {
  if (!record(definition) || Object.keys(definition).length > 24)
    throw Error('Invalid procedural parameter schema');
  for (const [name, field] of Object.entries(definition)) {
    if (!parameterNamePattern.test(name) || !record(field) ||
        !['number', 'integer', 'boolean'].includes(field.type))
      throw Error('Invalid procedural parameter field');
    if (field.type !== 'boolean') {
      const validNumber = field.type === 'integer' ? Number.isSafeInteger : finite;
      if (!exactKeys(field, ['type', 'default', 'min', 'max']) ||
          !validNumber(field.min) || !validNumber(field.max) ||
          !validNumber(field.default) ||
          field.min >= field.max || field.default < field.min || field.default > field.max)
        throw Error('Invalid procedural numeric parameter');
    } else if (!exactKeys(field, ['type', 'default']) || typeof field.default !== 'boolean') {
      throw Error('Invalid procedural boolean parameter');
    }
  }
  return definition;
}

function normalizedParameters(schema, input, partial) {
  if (!record(input)) throw Error('Invalid procedural parameters');
  for (const key of Object.keys(input))
    if (!Object.hasOwn(schema, key)) throw Error(`Unknown procedural parameter: ${key}`);
  const parameters = {};
  for (const [name, field] of Object.entries(schema)) {
    if (!partial && !Object.hasOwn(input, name))
      throw Error(`Missing procedural parameter: ${name}`);
    const value = Object.hasOwn(input, name) ? input[name] : field.default;
    const validValue = field.type === 'number' ? finite(value) :
      field.type === 'integer' ? Number.isSafeInteger(value) :
        typeof value === 'boolean';
    if (!validValue || (field.type !== 'boolean' &&
        (value < field.min || value > field.max)))
      throw Error(`Invalid procedural parameter: ${name}`);
    parameters[name] = value;
  }
  return parameters;
}

function addQuad(positions, indices, a, b, c, d) {
  const start = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

// The sloped top is real mesh geometry, so changing rise regenerates its
// collision surface rather than stretching a level cached box.
function prism(x0, x1, z0, z1, top0, top1, thickness) {
  const positions = [], indices = [];
  const a = [x0, top0, z0], b = [x1, top1, z0];
  const c = [x1, top1, z1], d = [x0, top0, z1];
  const e = [x0, top0 - thickness, z0], f = [x1, top1 - thickness, z0];
  const g = [x1, top1 - thickness, z1], h = [x0, top0 - thickness, z1];
  addQuad(positions, indices, d, c, b, a); // top
  addQuad(positions, indices, e, f, g, h); // underside
  addQuad(positions, indices, h, g, c, d); // positive Z
  addQuad(positions, indices, f, e, a, b); // negative Z
  addQuad(positions, indices, e, h, d, a); // negative X
  addQuad(positions, indices, g, f, b, c); // positive X
  return {positions, indices};
}

function box(x, y, z, width, height, depth) {
  return prism(x - width / 2, x + width / 2, z - depth / 2, z + depth / 2,
    y + height / 2, y + height / 2, height);
}

function annularStrip(inner, outer, bottom, top, angle, centerZ, segments = 12) {
  const positions = [], indices = [];
  const point = (radius, theta, height) =>
    [radius * Math.sin(theta), height, radius * Math.cos(theta) - centerZ];
  for (let step = 0; step < segments; step++) {
    const first = -angle / 2 + angle * step / segments;
    const last = -angle / 2 + angle * (step + 1) / segments;
    addQuad(positions, indices,
      point(inner, first, top), point(outer, first, top),
      point(outer, last, top), point(inner, last, top));
    addQuad(positions, indices,
      point(inner, last, bottom), point(outer, last, bottom),
      point(outer, first, bottom), point(inner, first, bottom));
    addQuad(positions, indices,
      point(outer, first, bottom), point(outer, last, bottom),
      point(outer, last, top), point(outer, first, top));
    addQuad(positions, indices,
      point(inner, last, bottom), point(inner, first, bottom),
      point(inner, first, top), point(inner, last, top));
  }
  addQuad(positions, indices,
    point(inner, -angle / 2, bottom), point(outer, -angle / 2, bottom),
    point(outer, -angle / 2, top), point(inner, -angle / 2, top));
  addQuad(positions, indices,
    point(outer, angle / 2, bottom), point(inner, angle / 2, bottom),
    point(inner, angle / 2, top), point(outer, angle / 2, top));
  return {positions, indices};
}

const materials = Object.freeze({
  deck: Object.freeze({color: '#9d805d', roughness: .82, metalness: 0}),
  steel: Object.freeze({color: '#718995', roughness: .52, metalness: .38}),
  bench: Object.freeze({color: '#b98255', roughness: .76, metalness: 0})
});

function part(partId, geometry, material) {
  return {partId, geometry, material: clone(material),
    collision: {kind: 'static-trimesh'}};
}

const bridgeGenerator = {
  generatorId: 'bridge', generatorVersion: '1.0.0', sourceRevision: 'bridge-v1',
  description: 'A parameterized deck with optional railings and supports; rise makes a ramp.',
  dependencies: [],
  parameterSchema: {
    lengthMeters: {type: 'number', default: 6, min: 2, max: 12},
    widthMeters: {type: 'number', default: 1.5, min: .8, max: 4},
    deckHeightMeters: {type: 'number', default: 1.2, min: .2, max: 3},
    riseMeters: {type: 'number', default: 0, min: -2, max: 2},
    railings: {type: 'boolean', default: true},
    supports: {type: 'boolean', default: true}
  },
  estimate(p) {
    const count = 1 + (p.railings ? 6 : 0) + (p.supports ? 4 : 0);
    return {parts: count, vertices: count * 24, triangles: count * 12,
      bufferBytes: count * (24 * 3 + 12 * 3) * 4};
  },
  build(p) {
    const {lengthMeters: length, widthMeters: width, deckHeightMeters: height,
      riseMeters: rise} = p;
    const deckThickness = .16;
    if (height - Math.abs(rise) / 2 < deckThickness)
      throw Error('Bridge deck would extend below the virtual floor');
    const deckY = x => height + rise * x / length;
    const parts = [part('deck', prism(-length / 2, length / 2,
      -width / 2, width / 2, deckY(-length / 2), deckY(length / 2),
      deckThickness), materials.deck)];
    for (const [side, sign] of [['front', 1], ['back', -1]]) {
      const z = sign * (width / 2 + .04);
      if (p.railings) {
        parts.push(part(`rail-${side}`,
          prism(-length / 2 + .12, length / 2 - .12, z - .035, z + .035,
            deckY(-length / 2 + .12) + .95,
            deckY(length / 2 - .12) + .95, .07), materials.steel));
        for (const [end, x] of [['left', -length / 2 + .16],
          ['right', length / 2 - .16]]) {
          const bottom = deckY(x) + .02, top = deckY(x) + .96;
          parts.push(part(`rail-post-${side}-${end}`,
            box(x, (bottom + top) / 2, z, .07, top - bottom, .07), materials.steel));
        }
      }
      if (p.supports) {
        for (const [end, x] of [['left', -length / 2 + .24],
          ['right', length / 2 - .24]]) {
          const top = deckY(x) - deckThickness;
          parts.push(part(`support-${side}-${end}`,
            box(x, top / 2, sign * (width / 2 - .14), .16, top, .16),
          materials.steel));
        }
      }
    }
    return {parts};
  }
};

const curvedBenchGenerator = {
  generatorId: 'curved-bench', generatorVersion: '1.0.0',
  sourceRevision: 'curved-bench-v1',
  description: 'A true curved seat and back with independently parameterized arc and supports.',
  dependencies: [],
  parameterSchema: {
    lengthMeters: {type: 'number', default: 1.8, min: .8, max: 3},
    depthMeters: {type: 'number', default: .5, min: .3, max: .8},
    seatHeightMeters: {type: 'number', default: .46, min: .35, max: .7},
    backHeightMeters: {type: 'number', default: .45, min: .25, max: .8},
    arcDegrees: {type: 'number', default: 75, min: 30, max: 120}
  },
  estimate() {
    // Two 12-segment closed curved strips and two six-face box legs.
    return {parts: 4, vertices: 448, triangles: 224,
      bufferBytes: (448 * 3 + 224 * 3) * 4};
  },
  build(p) {
    const angle = p.arcDegrees * Math.PI / 180;
    const radius = p.lengthMeters / (2 * Math.sin(angle / 2));
    const centerZ = radius * Math.cos(angle / 2);
    const inner = radius - p.depthMeters / 2;
    const outer = radius + p.depthMeters / 2;
    if (inner <= .04) throw Error('Bench curvature leaves no inner radius');
    const seatTop = p.seatHeightMeters;
    const parts = [
      part('seat', annularStrip(inner, outer, seatTop - .09, seatTop,
        angle, centerZ), materials.bench),
      part('back', annularStrip(outer - .055, outer + .015,
        seatTop + .015, seatTop + p.backHeightMeters,
        angle, centerZ), materials.bench)
    ];
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const theta = sign * angle * .4;
      const x = radius * Math.sin(theta);
      const z = radius * Math.cos(theta) - centerZ;
      const legHeight = seatTop - .09;
      parts.push(part(`leg-${side}`,
        box(x, legHeight / 2, z, .11, legHeight, .13), materials.steel));
    }
    return {parts};
  }
};

const staircaseGenerator = {
  generatorId: 'staircase', generatorVersion: '1.0.0',
  sourceRevision: 'staircase-v1',
  description: 'A bounded straight staircase with flat treads rising along local +X.',
  dependencies: [],
  parameterSchema: {
    stepCount: {type: 'integer', default: 6, min: 2, max: 12},
    widthMeters: {type: 'number', default: 1.2, min: .8, max: 3},
    treadDepthMeters: {type: 'number', default: .32, min: .25, max: .5},
    stepRiseMeters: {type: 'number', default: .18, min: .12, max: .25}
  },
  estimate(p) {
    if (!Number.isSafeInteger(p.stepCount))
      throw Error('Staircase stepCount must be a whole number');
    // Each closed prism has six quads, with independent face vertices.
    return {parts: p.stepCount, vertices: p.stepCount * 24,
      triangles: p.stepCount * 12, bufferBytes: p.stepCount * 432};
  },
  build(p) {
    const run = p.stepCount * p.treadDepthMeters;
    const parts = [];
    for (let index = 0; index < p.stepCount; index++) {
      const height = (index + 1) * p.stepRiseMeters;
      const x = -run / 2 + (index + .5) * p.treadDepthMeters;
      parts.push(part(`step-${String(index + 1).padStart(2, '0')}`,
        box(x, height / 2, 0, p.treadDepthMeters, height, p.widthMeters),
        materials.deck));
    }
    return {parts};
  }
};

function measuredGeometry(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > PROCEDURAL_BUDGET.parts)
    throw Error('Invalid procedural part count');
  const min = {x: Infinity, y: Infinity, z: Infinity};
  const max = {x: -Infinity, y: -Infinity, z: -Infinity};
  const seen = new Set();
  let vertices = 0, triangles = 0;
  for (const entry of parts) {
    if (!exactKeys(entry, ['partId', 'geometry', 'material', 'collision']) ||
        typeof entry.partId !== 'string' || !idPattern.test(entry.partId) ||
        seen.has(entry.partId)) throw Error('Invalid procedural semantic part');
    seen.add(entry.partId);
    if (!exactKeys(entry.collision, ['kind']) ||
        entry.collision.kind !== 'static-trimesh')
      throw Error('Invalid procedural collision metadata');
    if (!exactKeys(entry.material, ['color', 'roughness', 'metalness']) ||
        typeof entry.material.color !== 'string' ||
        !/^#[0-9a-fA-F]{6}$/.test(entry.material.color) ||
        !finite(entry.material.roughness) || entry.material.roughness < 0 ||
        entry.material.roughness > 1 || !finite(entry.material.metalness) ||
        entry.material.metalness < 0 || entry.material.metalness > 1)
      throw Error('Invalid procedural material');
    const geometry = entry.geometry;
    if (!exactKeys(geometry, ['positions', 'indices']) ||
        !Array.isArray(geometry.positions) || geometry.positions.length < 9 ||
        geometry.positions.length % 3 !== 0 ||
        !Array.isArray(geometry.indices) || geometry.indices.length < 3 ||
        geometry.indices.length % 3 !== 0)
      throw Error('Invalid procedural mesh');
    const count = geometry.positions.length / 3;
    vertices += count; triangles += geometry.indices.length / 3;
    if (vertices > PROCEDURAL_BUDGET.vertices ||
        triangles > PROCEDURAL_BUDGET.triangles)
      throw Error('Procedural geometry budget exceeded');
    for (let index = 0; index < geometry.positions.length; index += 3)
      for (const [axis, offset] of [['x', 0], ['y', 1], ['z', 2]]) {
        const value = geometry.positions[index + offset];
        if (!finite(value) || Math.abs(value) > 20)
          throw Error('Invalid procedural vertex');
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    for (const index of geometry.indices)
      if (!Number.isSafeInteger(index) || index < 0 || index >= count)
        throw Error('Invalid procedural mesh index');
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const [a, b, c] = geometry.indices.slice(index, index + 3);
      if (a === b || b === c || a === c)
        throw Error('Degenerate procedural triangle');
      const at = a * 3, bt = b * 3, ct = c * 3;
      const ab = [0, 1, 2].map(axis => geometry.positions[bt + axis] - geometry.positions[at + axis]);
      const ac = [0, 1, 2].map(axis => geometry.positions[ct + axis] - geometry.positions[at + axis]);
      const cross = [ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      if (Math.hypot(...cross) < 1e-9)
        throw Error('Degenerate procedural triangle');
    }
  }
  const size = Object.fromEntries(['x', 'y', 'z'].map(axis =>
    [axis, max[axis] - min[axis]]));
  if (Object.values(size).some(value => value < .001 || value > 20))
    throw Error('Invalid procedural bounds');
  const center = Object.fromEntries(['x', 'y', 'z'].map(axis =>
    [axis, (max[axis] + min[axis]) / 2]));
  const budget = {parts: parts.length, vertices, triangles,
    bufferBytes: (vertices * 3 + triangles * 3) * 4};
  assertBudget(budget);
  return {localBounds: {center, size}, budget};
}

/** Validate a generated result before renderer/physics allocation or save. */
export function validateProceduralOutput(value, normalizeRecipe = null) {
  if (!exactKeys(value, ['recipe', 'parts', 'localBounds', 'budget']))
    throw Error('Invalid procedural output');
  const canonicalRecipe = (normalizeRecipe || registry.normalizeRecipe)(value.recipe);
  if (JSON.stringify(canonicalRecipe) !== JSON.stringify(value.recipe))
    throw Error('Procedural output recipe is not canonical');
  const measured = measuredGeometry(value.parts);
  if (!exactKeys(value.localBounds, ['center', 'size']) ||
      !exactKeys(value.localBounds.center, ['x', 'y', 'z']) ||
      !exactKeys(value.localBounds.size, ['x', 'y', 'z']))
    throw Error('Invalid procedural bounds');
  for (const section of ['center', 'size'])
    for (const axis of ['x', 'y', 'z'])
      if (!finite(value.localBounds[section][axis]) ||
          Math.abs(value.localBounds[section][axis] -
            measured.localBounds[section][axis]) > 1e-6)
        throw Error('Procedural bounds do not match mesh');
  if (!exactKeys(value.budget, ['parts', 'vertices', 'triangles', 'bufferBytes']) ||
      Object.keys(measured.budget).some(key => value.budget[key] !== measured.budget[key]))
    throw Error('Procedural budget does not match mesh');
  return true;
}

/** New definitions must be imported from reviewed application code. */
export function createProceduralRegistry(definitions) {
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 32)
    throw Error('Invalid procedural registry');
  const entries = new Map();
  for (const definition of definitions) {
    if (!record(definition) || !idPattern.test(definition.generatorId) ||
        !versionPattern.test(definition.generatorVersion) ||
        typeof definition.sourceRevision !== 'string' ||
        !idPattern.test(definition.sourceRevision) ||
        typeof definition.description !== 'string' ||
        !definition.description || definition.description.length > 240 ||
        !Array.isArray(definition.dependencies) || definition.dependencies.length !== 0 ||
        typeof definition.estimate !== 'function' ||
        typeof definition.build !== 'function' || entries.has(definition.generatorId))
      throw Error('Invalid procedural generator definition');
    parameterSchema(definition.parameterSchema);
    entries.set(definition.generatorId, definition);
  }
  const metadata = definition => clone({
    generatorId: definition.generatorId,
    generatorVersion: definition.generatorVersion,
    sourceRevision: definition.sourceRevision,
    description: definition.description,
    parameterSchema: definition.parameterSchema,
    dependencies: definition.dependencies
  });
  const known = generatorId => {
    const definition = entries.get(generatorId);
    if (!definition) throw Error(`Unavailable procedural generator: ${generatorId}`);
    return definition;
  };
  const createRecipe = (generatorId, parameters = {}, seed = 0) => {
    const definition = known(generatorId);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw Error('Invalid procedural seed');
    return {schemaVersion: PROCEDURAL_SCHEMA_VERSION, generatorId,
      generatorVersion: definition.generatorVersion,
      sourceRevision: definition.sourceRevision,
      parameters: normalizedParameters(definition.parameterSchema, parameters, true),
      seed, dependencies: clone(definition.dependencies)};
  };
  const normalizeRecipe = recipe => {
    if (!exactKeys(recipe, ['schemaVersion', 'generatorId', 'generatorVersion',
      'sourceRevision', 'parameters', 'seed', 'dependencies']) ||
        recipe.schemaVersion !== PROCEDURAL_SCHEMA_VERSION)
      throw Error('Invalid procedural recipe');
    const definition = known(recipe.generatorId);
    if (recipe.generatorVersion !== definition.generatorVersion ||
        recipe.sourceRevision !== definition.sourceRevision ||
        JSON.stringify(recipe.dependencies) !== JSON.stringify(definition.dependencies))
      throw Error('Saved procedural generator version or dependency unavailable');
    if (!Number.isSafeInteger(recipe.seed) || recipe.seed < 0 ||
        recipe.seed > 0xffffffff) throw Error('Invalid procedural seed');
    return {...createRecipe(recipe.generatorId,
      normalizedParameters(definition.parameterSchema, recipe.parameters, false),
      recipe.seed)};
  };
  const reviseRecipe = (recipe, parameterPatch) => {
    const current = normalizeRecipe(recipe);
    if (!record(parameterPatch) || Object.keys(parameterPatch).length < 1)
      throw Error('Invalid procedural parameter patch');
    const definition = known(current.generatorId);
    const parameters = normalizedParameters(definition.parameterSchema,
      {...current.parameters, ...parameterPatch}, false);
    return {...current, parameters};
  };
  const generate = recipe => {
    const normalized = normalizeRecipe(recipe);
    const definition = known(normalized.generatorId);
    const estimate = assertBudget(definition.estimate(normalized.parameters));
    const generated = definition.build(normalized.parameters, normalized.seed);
    if (!exactKeys(generated, ['parts'])) throw Error('Invalid procedural generator result');
    const measured = measuredGeometry(generated.parts);
    for (const key of Object.keys(measured.budget))
      if (measured.budget[key] > estimate[key])
        throw Error('Procedural generator exceeded its preallocation estimate');
    const result = {recipe: normalized, parts: generated.parts,
      localBounds: measured.localBounds, budget: measured.budget};
    validateProceduralOutput(result, normalizeRecipe);
    return result;
  };
  return Object.freeze({
    list: () => [...entries.values()].map(metadata), createRecipe,
    normalizeRecipe, reviseRecipe, generate
  });
}

const registry = createProceduralRegistry([
  bridgeGenerator, curvedBenchGenerator, staircaseGenerator]);
export const listProceduralGenerators = () => registry.list();
export const createProceduralRecipe = (...args) => registry.createRecipe(...args);
export const normalizeProceduralRecipe = recipe => registry.normalizeRecipe(recipe);
export const reviseProceduralRecipe = (recipe, patch) => registry.reviseRecipe(recipe, patch);
export const generateProcedural = recipe => registry.generate(recipe);
