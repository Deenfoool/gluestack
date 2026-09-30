import * as THREE from 'three';
import {
  cloneTriangle,
  edgeKey,
  makeTriangle,
  orderBoundaryLoop,
  triangleNormal,
  triangulateLoop,
} from './topology.js';

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
}

function pushOriented(target, ids, normal, materialIndex, vertices) {
  const oriented = [...ids];
  if (triangleNormal({ v: oriented }, vertices).dot(normal) < 0) [oriented[1], oriented[2]] = [oriented[2], oriented[1]];
  target.push(makeTriangle(oriented, materialIndex));
}

export function loopCut(controller, factor = 0.5) {
  if (
    controller.selectionMode !== 'edge'
    || controller.selectedEdges.size !== 1
    || !Number.isFinite(factor)
    || factor <= 0
    || factor >= 1
  ) {
    controller.status('Loop Cut: выберите одно ребро, factor 0..1');
    return false;
  }

  const startKey = [...controller.selectedEdges][0];
  const groupLoops = new Map();
  const edgeToGroups = new Map();
  for (const group of controller.faceGroups) {
    const loop = orderBoundaryLoop(group.boundary);
    if (loop.length !== 4) continue;
    groupLoops.set(group.id, loop);
    for (let i = 0; i < 4; i += 1) {
      const key = edgeKey(loop[i], loop[(i + 1) % 4]);
      if (!edgeToGroups.has(key)) edgeToGroups.set(key, []);
      edgeToGroups.get(key).push(group.id);
    }
  }
  if (!edgeToGroups.has(startKey)) {
    controller.status('Loop Cut: выбранное ребро не входит в quad-strip');
    return false;
  }

  const queue = [startKey];
  const queuedEdges = new Set([startKey]);
  const visitedGroups = new Set();
  const cutEdges = new Set([startKey]);
  const groupCuts = new Map();

  while (queue.length) {
    const currentKey = queue.shift();
    for (const groupId of edgeToGroups.get(currentKey) ?? []) {
      if (visitedGroups.has(groupId)) continue;
      const loop = groupLoops.get(groupId);
      const edgeIndex = [0, 1, 2, 3].find((index) => (
        edgeKey(loop[index], loop[(index + 1) % 4]) === currentKey
      ));
      if (edgeIndex === undefined) continue;
      const oppositeIndex = (edgeIndex + 2) % 4;
      const oppositeKey = edgeKey(loop[oppositeIndex], loop[(oppositeIndex + 1) % 4]);
      visitedGroups.add(groupId);
      cutEdges.add(oppositeKey);
      groupCuts.set(groupId, { edgeA: currentKey, edgeB: oppositeKey });
      if (!queuedEdges.has(oppositeKey)) {
        queuedEdges.add(oppositeKey);
        queue.push(oppositeKey);
      }
    }
  }

  if (!visitedGroups.size) {
    controller.status('Loop Cut: quad-strip не найден');
    return false;
  }

  const edgeLookup = new Map(controller.edges.map((edge) => [edge.key, edge]));
  if ([...cutEdges].some((key) => !edgeLookup.has(key))) {
    controller.status('Loop Cut: strip содержит неподдерживаемое ребро');
    return false;
  }

  const vertices = cloneVertices(controller.vertices);
  const midpointIds = new Map();
  for (const key of cutEdges) {
    const edge = edgeLookup.get(key);
    const id = vertices.length;
    vertices.push({
      position: controller.vertices[edge.a].position.clone().lerp(controller.vertices[edge.b].position, factor),
      sources: [],
    });
    midpointIds.set(key, id);
  }

  const remove = new Set();
  visitedGroups.forEach((groupId) => controller.faceGroups[groupId].triangles.forEach((id) => remove.add(id)));
  const triangles = controller.triangles.filter((_, index) => !remove.has(index)).map(cloneTriangle);
  controller.editor.checkpoint('Loop cut');
  controller.vertices = vertices;

  for (const groupId of visitedGroups) {
    const group = controller.faceGroups[groupId];
    const loop = groupLoops.get(groupId);
    const cut = groupCuts.get(groupId);
    const indexA = [0, 1, 2, 3].find((index) => (
      edgeKey(loop[index], loop[(index + 1) % 4]) === cut.edgeA
    ));
    if (indexA === undefined) continue;
    const rotated = Array.from({ length: 4 }, (_, offset) => loop[(indexA + offset) % 4]);
    const keyA = edgeKey(rotated[0], rotated[1]);
    const keyB = edgeKey(rotated[2], rotated[3]);
    if (keyB !== cut.edgeB) continue;

    const mA = midpointIds.get(keyA);
    const mB = midpointIds.get(keyB);
    const materialIndex = controller.triangles[group.triangles[0]]?.materialIndex ?? 0;
    triangles.push(...triangulateLoop(
      [mA, rotated[1], rotated[2], mB],
      group.normal,
      materialIndex,
      vertices,
    ));
    triangles.push(...triangulateLoop(
      [mA, mB, rotated[3], rotated[0]],
      group.normal,
      materialIndex,
      vertices,
    ));
  }

  controller.rebuildMesh(triangles);
  controller.status(`Loop Cut · ${visitedGroups.size} quad(s) · factor ${factor}`);
  return true;
}

export function knifeCenter(controller) {
  if (controller.selectionMode !== 'face' || controller.selectedFaces.size !== 1) {
    controller.status('Knife Center: выберите одну грань');
    return false;
  }
  const group = controller.faceGroups[[...controller.selectedFaces][0]];
  const loop = orderBoundaryLoop(group?.boundary ?? []);
  if (!group || loop.length < 3) {
    controller.status('Knife Center: нужен простой замкнутый контур');
    return false;
  }

  const vertices = cloneVertices(controller.vertices);
  const center = new THREE.Vector3();
  loop.forEach((id) => center.add(controller.vertices[id].position));
  center.multiplyScalar(1 / loop.length);
  const centerId = vertices.length;
  vertices.push({ position: center, sources: [] });

  const remove = new Set(group.triangles);
  const triangles = controller.triangles.filter((_, index) => !remove.has(index)).map(cloneTriangle);
  const materialIndex = controller.triangles[group.triangles[0]]?.materialIndex ?? 0;
  controller.editor.checkpoint('Knife center');
  controller.vertices = vertices;
  for (let i = 0; i < loop.length; i += 1) {
    pushOriented(
      triangles,
      [loop[i], loop[(i + 1) % loop.length], centerId],
      group.normal,
      materialIndex,
      vertices,
    );
  }

  controller.rebuildMesh(triangles);
  controller.status(`Knife Center · ${loop.length} разрезов к центру`);
  return true;
}
