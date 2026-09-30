import * as THREE from 'three';

const SKIP_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'tangent']);

function readTuple(attribute, index) {
  const tuple = [attribute.getX(index)];
  if (attribute.itemSize > 1) tuple.push(attribute.getY(index));
  if (attribute.itemSize > 2) tuple.push(attribute.getZ(index));
  if (attribute.itemSize > 3) tuple.push(attribute.getW(index));
  return tuple;
}

export function createAttributeState(geometry) {
  const meta = {};
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (SKIP_ATTRIBUTES.has(name)) continue;
    meta[name] = { itemSize: attribute.itemSize };
  }
  return { meta };
}

export function readCornerAttributes(geometry, state, sourceIndices) {
  const attrs = {};
  for (const [name] of Object.entries(state.meta)) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    attrs[name] = sourceIndices.map((sourceIndex) => readTuple(attribute, sourceIndex));
  }
  return attrs;
}

export function cloneCornerAttributes(attrs = {}) {
  return Object.fromEntries(Object.entries(attrs).map(([name, corners]) => (
    [name, corners.map((tuple) => [...tuple])]
  )));
}

export function writeCornerAttributes(geometry, state, triangles) {
  for (const [name, meta] of Object.entries(state?.meta ?? {})) {
    const values = [];
    for (const triangle of triangles) {
      for (let corner = 0; corner < 3; corner += 1) {
        const tuple = triangle.attrs?.[name]?.[corner] ?? [];
        for (let component = 0; component < meta.itemSize; component += 1) {
          values.push(tuple[component] ?? 0);
        }
      }
    }
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, meta.itemSize));
  }
}

export function interpolateTuple(a = [], b = [], factor = 0.5) {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, index) => (
    (a[index] ?? 0) + ((b[index] ?? 0) - (a[index] ?? 0)) * factor
  ));
}

export function averageTuples(tuples = []) {
  const length = Math.max(0, ...tuples.map((tuple) => tuple?.length ?? 0));
  if (!tuples.length) return new Array(length).fill(0);
  return Array.from({ length }, (_, index) => (
    tuples.reduce((sum, tuple) => sum + (tuple?.[index] ?? 0), 0) / tuples.length
  ));
}

export function cornerAttributesForVertex(triangle, vertexId) {
  const corner = triangle.v.indexOf(vertexId);
  if (corner < 0) return {};
  const result = {};
  for (const [name, corners] of Object.entries(triangle.attrs ?? {})) result[name] = [...corners[corner]];
  return result;
}

export function faceAttributeMaps(group, triangles) {
  const maps = {};
  for (const triangleIndex of group.triangles) {
    const triangle = triangles[triangleIndex];
    triangle.v.forEach((vertexId, corner) => {
      for (const [name, corners] of Object.entries(triangle.attrs ?? {})) {
        if (!maps[name]) maps[name] = new Map();
        if (!maps[name].has(vertexId)) maps[name].set(vertexId, [...corners[corner]]);
      }
    });
  }
  return maps;
}

export function attributesForTriangle(ids, maps) {
  const attrs = {};
  for (const [name, map] of Object.entries(maps ?? {})) {
    attrs[name] = ids.map((id) => [...(map.get(id) ?? [])]);
  }
  return attrs;
}
