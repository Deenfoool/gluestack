import * as THREE from 'three';
import {
  attributesForTriangle,
  averageTuples,
  cornerAttributesForVertex,
  faceAttributeMaps,
  interpolateTuple,
} from './attributes.js';
import {
  EPSILON,
  boundaryEdgesForTriangles,
  cloneTriangle,
  edgeKey,
  estimateLoopNormal,
  makeTriangle,
  orderBoundaryLoop,
  triangleNormal,
  triangulateLoop,
} from './topology.js';

export function deleteSelection(controller) {
  if (!controller.selectedCount()) return false;
  controller.editor.checkpoint('Edit delete');
  const remove = new Set();

  if (controller.selectionMode === 'face') {
    controller.getSelectedTriangleIds().forEach((id) => remove.add(id));
  } else if (controller.selectionMode === 'vertex') {
    const selected = new Set(controller.selectedVertices);
    controller.triangles.forEach((triangle, index) => {
      if (triangle.v.some((vertexId) => selected.has(vertexId))) remove.add(index);
    });
  } else {
    controller.triangles.forEach((triangle, index) => {
      const keys = [
        edgeKey(triangle.v[0], triangle.v[1]),
        edgeKey(triangle.v[1], triangle.v[2]),
        edgeKey(triangle.v[2], triangle.v[0]),
      ];
      if (keys.some((key) => controller.selectedEdges.has(key))) remove.add(index);
    });
  }

  controller.rebuildMesh(controller.triangles.filter((_, index) => !remove.has(index)));
  controller.status(`Удалено треугольников: ${remove.size}`);
  return true;
}

export function extrude(controller, distance = 0.25) {
  const selectedTriangles = controller.getSelectedTriangleIds();
  if (controller.selectionMode !== 'face' || !selectedTriangles.size || !Number.isFinite(distance)) {
    controller.status('Extrude: выберите Face в Face Select');
    return false;
  }

  controller.editor.checkpoint('Extrude faces');
  const boundary = boundaryEdgesForTriangles(controller.triangles, selectedTriangles);
  const selectedVertices = new Set();
  selectedTriangles.forEach((triangleIndex) => (
    controller.triangles[triangleIndex].v.forEach((id) => selectedVertices.add(id))
  ));

  const normals = new Map();
  selectedVertices.forEach((id) => normals.set(id, new THREE.Vector3()));
  selectedTriangles.forEach((triangleIndex) => {
    const normal = triangleNormal(controller.triangles[triangleIndex], controller.vertices);
    controller.triangles[triangleIndex].v.forEach((id) => normals.get(id).add(normal));
  });

  const vertices = controller.vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
  const duplicate = new Map();
  for (const id of selectedVertices) {
    const normal = normals.get(id);
    if (normal.lengthSq() < EPSILON) normal.set(0, 1, 0);
    normal.normalize();
    duplicate.set(id, vertices.length);
    vertices.push({ position: controller.vertices[id].position.clone().addScaledVector(normal, distance), sources: [] });
  }

  const triangles = controller.triangles
    .filter((_, index) => !selectedTriangles.has(index))
    .map(cloneTriangle);
  for (const triangleIndex of selectedTriangles) {
    const top = cloneTriangle(controller.triangles[triangleIndex]);
    top.v = top.v.map((id) => duplicate.get(id));
    triangles.push(top);
  }
  for (const edge of boundary) {
    const na = duplicate.get(edge.a);
    const nb = duplicate.get(edge.b);
    const source = controller.triangles[edge.triangleIndex];
    const materialIndex = source?.materialIndex ?? 0;
    const aAttrs = cornerAttributesForVertex(source, edge.a);
    const bAttrs = cornerAttributesForVertex(source, edge.b);
    const attrNames = new Set([...Object.keys(aAttrs), ...Object.keys(bAttrs)]);
    const attrs1 = {};
    const attrs2 = {};
    for (const name of attrNames) {
      const a = aAttrs[name] ?? [];
      const b = bAttrs[name] ?? [];
      attrs1[name] = [[...a], [...b], [...b]];
      attrs2[name] = [[...a], [...b], [...a]];
    }
    triangles.push(makeTriangle([edge.a, edge.b, nb], materialIndex, [[0, 0], [1, 0], [1, 1]], attrs1));
    triangles.push(makeTriangle([edge.a, nb, na], materialIndex, [[0, 0], [1, 1], [0, 1]], attrs2));
  }

  controller.vertices = vertices;
  controller.rebuildMesh(triangles);
  controller.status(`Extrude ${distance}`);
  return true;
}

export function inset(controller, factor = 0.2) {
  if (
    controller.selectionMode !== 'face'
    || controller.selectedFaces.size !== 1
    || !Number.isFinite(factor)
    || factor <= 0
    || factor >= 1
  ) {
    controller.status('Inset: выберите одну плоскую грань, factor 0..1');
    return false;
  }

  const group = controller.faceGroups[[...controller.selectedFaces][0]];
  const loop = orderBoundaryLoop(group?.boundary ?? []);
  if (!group || loop.length < 3) {
    controller.status('Inset: граница выбранной грани не образует простой контур');
    return false;
  }

  controller.editor.checkpoint('Inset face');
  const center = new THREE.Vector3();
  loop.forEach((id) => center.add(controller.vertices[id].position));
  center.multiplyScalar(1 / loop.length);
  const vertices = controller.vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
  const attrMaps = faceAttributeMaps(group, controller.triangles);
  const centerAttrs = Object.fromEntries(Object.entries(attrMaps).map(([name, map]) => (
    [name, averageTuples(loop.map((id) => map.get(id) ?? []))]
  )));
  const inner = loop.map((id) => {
    const nextId = vertices.length;
    vertices.push({ position: controller.vertices[id].position.clone().lerp(center, factor), sources: [] });
    for (const [name, map] of Object.entries(attrMaps)) {
      map.set(nextId, interpolateTuple(map.get(id), centerAttrs[name], factor));
    }
    return nextId;
  });

  const remove = new Set(group.triangles);
  const triangles = controller.triangles.filter((_, index) => !remove.has(index)).map(cloneTriangle);
  const materialIndex = controller.triangles[group.triangles[0]]?.materialIndex ?? 0;
  controller.vertices = vertices;
  triangles.push(...triangulateLoop(inner, group.normal, materialIndex, vertices, null, attrMaps));
  for (let i = 0; i < loop.length; i += 1) {
    const next = (i + 1) % loop.length;
    const idsA = [loop[i], loop[next], inner[next]];
    const idsB = [loop[i], inner[next], inner[i]];
    triangles.push(makeTriangle(
      idsA,
      materialIndex,
      [[0, 0], [1, 0], [1, 1]],
      attributesForTriangle(idsA, attrMaps),
    ));
    triangles.push(makeTriangle(
      idsB,
      materialIndex,
      [[0, 0], [1, 1], [0, 1]],
      attributesForTriangle(idsB, attrMaps),
    ));
  }

  controller.rebuildMesh(triangles);
  controller.status(`Inset ${factor}`);
  return true;
}

export function mergeSelected(controller) {
  const selected = [...controller.getSelectedVertexIds()];
  if (selected.length < 2) {
    controller.status('Merge: выберите минимум 2 вершины/ребра/грани');
    return false;
  }

  controller.editor.checkpoint('Merge vertices');
  const center = new THREE.Vector3();
  selected.forEach((id) => center.add(controller.vertices[id].position));
  center.multiplyScalar(1 / selected.length);
  const keep = selected[0];
  const mergeSet = new Set(selected);
  controller.vertices[keep].position.copy(center);
  const triangles = controller.triangles
    .map((triangle) => ({
      ...cloneTriangle(triangle),
      v: triangle.v.map((id) => (mergeSet.has(id) ? keep : id)),
    }))
    .filter((triangle) => new Set(triangle.v).size === 3);
  controller.rebuildMesh(triangles);
  controller.status(`${selected.length} вершин объединено в центре`);
  return true;
}

export function fillSelected(controller) {
  if (controller.selectionMode !== 'edge' || controller.selectedEdges.size < 3) {
    controller.status('Fill: выберите замкнутый контур рёбер');
    return false;
  }

  const chosen = controller.edges
    .filter((edge) => controller.selectedEdges.has(edge.key))
    .map((edge) => ({ a: edge.a, b: edge.b }));
  const loop = orderBoundaryLoop(chosen);
  if (loop.length < 3) {
    controller.status('Fill: выбранные рёбра не образуют один замкнутый контур');
    return false;
  }

  controller.editor.checkpoint('Fill');
  const normal = estimateLoopNormal(loop, controller.vertices);
  const triangles = controller.triangles.map(cloneTriangle);
  const loopSet = new Set(loop);
  const touching = [];
  controller.triangles.forEach((triangle, index) => {
    if (triangle.v.some((id) => loopSet.has(id))) touching.push(index);
  });
  const attrMaps = faceAttributeMaps({ triangles: touching }, controller.triangles);
  triangles.push(...triangulateLoop(loop, normal, 0, controller.vertices, null, attrMaps));
  controller.rebuildMesh(triangles);
  controller.status(`Fill · ${loop.length} вершин`);
  return true;
}

export function recalculateNormals(controller) {
  controller.editor.checkpoint('Recalculate normals');
  controller.mesh.geometry.computeVertexNormals();
  controller.mesh.geometry.normalizeNormals();
  controller.status('Normals пересчитаны');
  return true;
}

export function flipNormals(controller) {
  const selected = controller.getSelectedTriangleIds();
  const flipAll = !selected.size;
  controller.editor.checkpoint('Flip normals');
  const triangles = controller.triangles.map((triangle, index) => {
    const next = cloneTriangle(triangle);
    if (flipAll || selected.has(index)) {
      [next.v[1], next.v[2]] = [next.v[2], next.v[1]];
      [next.uv[1], next.uv[2]] = [next.uv[2], next.uv[1]];
      for (const corners of Object.values(next.attrs ?? {})) {
        [corners[1], corners[2]] = [corners[2], corners[1]];
      }
    }
    return next;
  });
  controller.rebuildMesh(triangles);
  controller.status(flipAll ? 'Все normals перевёрнуты' : 'Normals выбранных граней перевёрнуты');
  return true;
}
