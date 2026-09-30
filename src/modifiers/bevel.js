import * as THREE from 'three';
import { faceAttributeMaps } from '../edit/attributes.js';
import {
  orderBoundaryLoop,
  readMeshTopology,
  triangulateLoop,
} from '../edit/topology.js';

function faceUvMap(group, triangles) {
  const map = new Map();
  for (const triangleIndex of group.triangles) {
    const triangle = triangles[triangleIndex];
    triangle.v.forEach((vertexId, corner) => {
      if (!map.has(vertexId)) map.set(vertexId, triangle.uv[corner].clone());
    });
  }
  return map;
}

function makeBasis(normal) {
  const helper = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(helper, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

export function applyBevelModifier(modifiers, factor = 0.08) {
  const mesh = modifiers.getMesh();
  factor = Number(factor);
  if (!mesh || !Number.isFinite(factor) || factor <= 0 || factor >= 0.45) {
    modifiers.onStatus('Bevel Modifier: factor должен быть 0..0.45');
    return false;
  }

  const topology = readMeshTopology(mesh);
  if (!topology.edges.length || topology.edges.some((edge) => edge.triangles.length !== 2)) {
    modifiers.onStatus('Bevel Modifier: базовая версия требует watertight / two-manifold Mesh');
    return false;
  }

  const vertices = [];
  const triangles = [];
  const faceVertexMap = new Map();
  const globalUv = new Map();
  const globalAttrs = Object.fromEntries(Object.keys(topology.attributeState.meta).map((name) => [name, new Map()]));
  const faceMaterials = new Map();

  for (const group of topology.faceGroups) {
    const loop = orderBoundaryLoop(group.boundary);
    if (loop.length < 3) {
      modifiers.onStatus('Bevel Modifier: найдена сложная грань без простого контура');
      return false;
    }
    const center = new THREE.Vector3();
    loop.forEach((id) => center.add(topology.vertices[id].position));
    center.multiplyScalar(1 / loop.length);
    const uvMap = faceUvMap(group, topology.triangles);
    const attrMaps = faceAttributeMaps(group, topology.triangles);
    const localMap = new Map();
    const newLoop = [];

    for (const originalId of loop) {
      const newId = vertices.length;
      vertices.push({
        position: topology.vertices[originalId].position.clone().lerp(center, factor),
        sources: [],
      });
      localMap.set(originalId, newId);
      newLoop.push(newId);
      globalUv.set(newId, (uvMap.get(originalId) ?? new THREE.Vector2()).clone());
      for (const [name, map] of Object.entries(globalAttrs)) {
        map.set(newId, [...(attrMaps[name]?.get(originalId) ?? [])]);
      }
    }

    faceVertexMap.set(group.id, localMap);
    const materialIndex = topology.triangles[group.triangles[0]]?.materialIndex ?? 0;
    faceMaterials.set(group.id, materialIndex);
    triangles.push(...triangulateLoop(newLoop, group.normal, materialIndex, vertices, globalUv, globalAttrs));
  }

  const incidentGroups = topology.vertices.map(() => new Set());
  topology.faceGroups.forEach((group) => {
    const loop = orderBoundaryLoop(group.boundary);
    loop.forEach((vertexId) => incidentGroups[vertexId].add(group.id));
  });

  for (const edge of topology.edges) {
    const groupIds = [...new Set(edge.triangles.map((triangleId) => topology.triangleToFaceGroup[triangleId]))];
    if (groupIds.length !== 2 || groupIds[0] === groupIds[1]) continue;
    const [groupA, groupB] = groupIds;
    const a1 = faceVertexMap.get(groupA)?.get(edge.a);
    const b1 = faceVertexMap.get(groupA)?.get(edge.b);
    const a2 = faceVertexMap.get(groupB)?.get(edge.a);
    const b2 = faceVertexMap.get(groupB)?.get(edge.b);
    if ([a1, b1, a2, b2].some((id) => id === undefined)) continue;
    const normal = topology.faceGroups[groupA].normal.clone().add(topology.faceGroups[groupB].normal);
    if (normal.lengthSq() < 1e-10) normal.copy(topology.faceGroups[groupA].normal);
    normal.normalize();
    triangles.push(...triangulateLoop(
      [a1, b1, b2, a2],
      normal,
      faceMaterials.get(groupA) ?? 0,
      vertices,
      globalUv,
      globalAttrs,
    ));
  }

  topology.vertices.forEach((original, originalId) => {
    const groups = [...incidentGroups[originalId]];
    if (groups.length < 3) return;
    const normal = new THREE.Vector3();
    groups.forEach((groupId) => normal.add(topology.faceGroups[groupId].normal));
    if (normal.lengthSq() < 1e-10) return;
    normal.normalize();
    const { u, v } = makeBasis(normal);
    const ids = groups
      .map((groupId) => faceVertexMap.get(groupId)?.get(originalId))
      .filter((id) => id !== undefined)
      .sort((a, b) => {
        const da = vertices[a].position.clone().sub(original.position);
        const db = vertices[b].position.clone().sub(original.position);
        return Math.atan2(da.dot(v), da.dot(u)) - Math.atan2(db.dot(v), db.dot(u));
      });
    if (ids.length < 3) return;
    triangles.push(...triangulateLoop(
      ids,
      normal,
      faceMaterials.get(groups[0]) ?? 0,
      vertices,
      globalUv,
      globalAttrs,
    ));
  });

  if (!triangles.length) {
    modifiers.onStatus('Bevel Modifier: не удалось построить chamfer topology');
    return false;
  }

  modifiers.editor.checkpoint('Bevel modifier');
  return modifiers.commit(mesh, vertices, triangles, topology.attributeState, `Bevel Modifier · factor ${factor}`);
}
