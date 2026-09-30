import * as THREE from 'three';
import {
  cloneCornerAttributes,
  createAttributeState,
  readCornerAttributes,
  writeCornerAttributes,
} from './attributes.js';

export const EPSILON = 1e-5;
const FACE_DOT_THRESHOLD = 0.9995;

export function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function positionKey(v) {
  return `${Math.round(v.x / EPSILON)}:${Math.round(v.y / EPSILON)}:${Math.round(v.z / EPSILON)}`;
}

export function triangleNormal(triangle, vertices) {
  const a = vertices[triangle.v[0]]?.position;
  const b = vertices[triangle.v[1]]?.position;
  const c = vertices[triangle.v[2]]?.position;
  if (!a || !b || !c) return new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(c, a),
  );
  return normal.lengthSq() > EPSILON ? normal.normalize() : new THREE.Vector3(0, 1, 0);
}

function materialIndexForOffset(geometry, offset) {
  if (!geometry.groups.length) return 0;
  return geometry.groups.find((g) => offset >= g.start && offset < g.start + g.count)?.materialIndex ?? 0;
}

export function readMeshTopology(mesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const index = geometry.index;
  const sourceToLogical = new Array(position.count);
  const grouped = new Map();
  const vertices = [];
  const attributeState = createAttributeState(geometry);

  for (let sourceIndex = 0; sourceIndex < position.count; sourceIndex += 1) {
    const vector = new THREE.Vector3().fromBufferAttribute(position, sourceIndex);
    const key = positionKey(vector);
    let logicalIndex = grouped.get(key);
    if (logicalIndex === undefined) {
      logicalIndex = vertices.length;
      grouped.set(key, logicalIndex);
      vertices.push({ position: vector.clone(), sources: [] });
    }
    vertices[logicalIndex].sources.push(sourceIndex);
    sourceToLogical[sourceIndex] = logicalIndex;
  }

  const triangleCount = Math.floor((index ? index.count : position.count) / 3);
  const triangles = [];
  const sourceFaceToTriangle = new Array(triangleCount).fill(-1);
  for (let sourceFace = 0; sourceFace < triangleCount; sourceFace += 1) {
    const offset = sourceFace * 3;
    const source = index
      ? [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)]
      : [offset, offset + 1, offset + 2];
    const logical = source.map((sourceIndex) => sourceToLogical[sourceIndex]);
    if (new Set(logical).size < 3) continue;
    sourceFaceToTriangle[sourceFace] = triangles.length;
    const attrs = readCornerAttributes(geometry, attributeState, source);
    triangles.push({
      v: logical,
      uv: source.map((sourceIndex) => (
        uv ? new THREE.Vector2().fromBufferAttribute(uv, sourceIndex) : new THREE.Vector2()
      )),
      attrs,
      materialIndex: materialIndexForOffset(geometry, offset),
    });
  }

  return {
    vertices,
    triangles,
    sourceFaceToTriangle,
    attributeState,
    ...buildTopology(vertices, triangles),
  };
}

export function buildTopology(vertices, triangles) {
  const edgeMap = new Map();
  const normals = triangles.map((triangle) => triangleNormal(triangle, vertices));

  triangles.forEach((triangle, triangleIndex) => {
    for (let side = 0; side < 3; side += 1) {
      const a = triangle.v[side];
      const b = triangle.v[(side + 1) % 3];
      const key = edgeKey(a, b);
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { key, a: Math.min(a, b), b: Math.max(a, b), triangles: [] };
        edgeMap.set(key, edge);
      }
      edge.triangles.push(triangleIndex);
    }
  });
  const edges = [...edgeMap.values()];

  const adjacency = triangles.map(() => new Set());
  for (const edge of edges) {
    if (edge.triangles.length !== 2) continue;
    const [a, b] = edge.triangles;
    if (
      triangles[a].materialIndex === triangles[b].materialIndex
      && normals[a].dot(normals[b]) >= FACE_DOT_THRESHOLD
    ) {
      adjacency[a].add(b);
      adjacency[b].add(a);
    }
  }

  const faceGroups = [];
  const triangleToFaceGroup = new Array(triangles.length).fill(-1);
  const visited = new Set();
  for (let start = 0; start < triangles.length; start += 1) {
    if (visited.has(start)) continue;
    const groupTriangles = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const current = stack.pop();
      groupTriangles.push(current);
      for (const next of adjacency[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    const id = faceGroups.length;
    groupTriangles.forEach((triangleIndex) => { triangleToFaceGroup[triangleIndex] = id; });
    faceGroups.push({
      id,
      triangles: groupTriangles,
      normal: normals[start].clone(),
      boundary: boundaryEdgesForTriangles(triangles, new Set(groupTriangles)),
    });
  }

  return { edges, faceGroups, triangleToFaceGroup };
}

export function boundaryEdgesForTriangles(triangles, triangleSet) {
  const occurrences = new Map();
  for (const triangleIndex of triangleSet) {
    const triangle = triangles[triangleIndex];
    for (let side = 0; side < 3; side += 1) {
      const a = triangle.v[side];
      const b = triangle.v[(side + 1) % 3];
      const key = edgeKey(a, b);
      const entry = occurrences.get(key) ?? { key, a, b, count: 0, triangleIndex };
      entry.count += 1;
      occurrences.set(key, entry);
    }
  }
  return [...occurrences.values()].filter((entry) => entry.count === 1);
}

export function syncLogicalPositions(mesh, vertices) {
  const position = mesh.geometry.getAttribute('position');
  for (const vertex of vertices) {
    for (const sourceIndex of vertex.sources) {
      position.setXYZ(sourceIndex, vertex.position.x, vertex.position.y, vertex.position.z);
    }
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

export function rebuildMeshGeometry(mesh, vertices, triangles, attributeState = createAttributeState(mesh.geometry)) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const runs = [];
  let currentMaterial = null;
  let runStart = 0;

  triangles.forEach((triangle, triangleIndex) => {
    if (triangle.materialIndex !== currentMaterial) {
      if (currentMaterial !== null) {
        runs.push({ start: runStart, count: triangleIndex * 3 - runStart, materialIndex: currentMaterial });
      }
      currentMaterial = triangle.materialIndex ?? 0;
      runStart = triangleIndex * 3;
    }
    triangle.v.forEach((vertexId, corner) => {
      const vertex = vertices[vertexId];
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
      const texcoord = triangle.uv?.[corner] ?? new THREE.Vector2();
      uvs.push(texcoord.x, texcoord.y);
    });
  });
  if (currentMaterial !== null) {
    runs.push({ start: runStart, count: triangles.length * 3 - runStart, materialIndex: currentMaterial });
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  writeCornerAttributes(geometry, attributeState, triangles);
  runs.forEach((run) => geometry.addGroup(run.start, run.count, run.materialIndex));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

export function cloneTriangle(triangle) {
  return {
    v: [...triangle.v],
    uv: triangle.uv.map((item) => item.clone()),
    attrs: cloneCornerAttributes(triangle.attrs),
    materialIndex: triangle.materialIndex ?? 0,
  };
}

export function makeTriangle(vertices, materialIndex = 0, uv = [[0, 0], [1, 0], [0, 1]], attrs = {}) {
  return {
    v: [...vertices],
    uv: uv.map(([x, y]) => new THREE.Vector2(x, y)),
    attrs: cloneCornerAttributes(attrs),
    materialIndex,
  };
}

export function orderBoundaryLoop(edges) {
  if (edges.length < 3) return [];
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  if ([...adjacency.values()].some((neighbors) => neighbors.length !== 2)) return [];

  const start = adjacency.keys().next().value;
  const loop = [start];
  let previous = null;
  let current = start;
  for (let guard = 0; guard < adjacency.size + 1; guard += 1) {
    const next = adjacency.get(current).find((value) => value !== previous);
    if (next === start) return loop.length === adjacency.size ? loop : [];
    if (next === undefined || loop.includes(next)) return [];
    loop.push(next);
    previous = current;
    current = next;
  }
  return [];
}

export function estimateLoopNormal(loop, vertices) {
  const normal = new THREE.Vector3();
  for (let i = 0; i < loop.length; i += 1) {
    const current = vertices[loop[i]].position;
    const next = vertices[loop[(i + 1) % loop.length]].position;
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }
  if (normal.lengthSq() < EPSILON) normal.set(0, 1, 0);
  return normal.normalize();
}

export function triangulateLoop(loop, desiredNormal, materialIndex, vertices, uvByVertex = null, attrsByVertex = null) {
  const result = [];
  for (let i = 1; i < loop.length - 1; i += 1) {
    const ids = [loop[0], loop[i], loop[i + 1]];
    if (triangleNormal({ v: ids }, vertices).dot(desiredNormal) < 0) [ids[1], ids[2]] = [ids[2], ids[1]];
    const uv = uvByVertex
      ? ids.map((id) => {
          const value = uvByVertex.get(id) ?? new THREE.Vector2();
          return [value.x, value.y];
        })
      : [[0, 0], [1, 0], [0, 1]];
    const attrs = {};
    if (attrsByVertex) {
      for (const [name, valueMap] of Object.entries(attrsByVertex)) {
        attrs[name] = ids.map((id) => [...(valueMap.get(id) ?? [])]);
      }
    }
    result.push(makeTriangle(ids, materialIndex, uv, attrs));
  }
  return result;
}
