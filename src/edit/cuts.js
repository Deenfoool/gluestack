import { faceAttributeMaps, interpolateTuple } from './attributes.js';
import {
  cloneTriangle,
  edgeKey,
  orderBoundaryLoop,
  triangulateLoop,
} from './topology.js';

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
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
    const attrMaps = faceAttributeMaps(group, controller.triangles);
    const edgeA = edgeLookup.get(keyA);
    const edgeB = edgeLookup.get(keyB);
    for (const map of Object.values(attrMaps)) {
      map.set(mA, interpolateTuple(map.get(edgeA.a), map.get(edgeA.b), factor));
      map.set(mB, interpolateTuple(map.get(edgeB.a), map.get(edgeB.b), factor));
    }
    const materialIndex = controller.triangles[group.triangles[0]]?.materialIndex ?? 0;
    triangles.push(...triangulateLoop(
      [mA, rotated[1], rotated[2], mB],
      group.normal,
      materialIndex,
      vertices,
      null,
      attrMaps,
    ));
    triangles.push(...triangulateLoop(
      [mA, mB, rotated[3], rotated[0]],
      group.normal,
      materialIndex,
      vertices,
      null,
      attrMaps,
    ));
  }

  controller.rebuildMesh(triangles);
  controller.status(`Loop Cut · ${visitedGroups.size} quad(s) · factor ${factor}`);
  return true;
}
