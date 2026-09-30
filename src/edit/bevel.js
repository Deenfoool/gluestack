import * as THREE from 'three';
import { cloneTriangle, makeTriangle, orderBoundaryLoop, triangleNormal, triangulateLoop } from './topology.js';

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
}

function pushOriented(target, ids, normal, materialIndex, vertices) {
  const oriented = [...ids];
  if (triangleNormal({ v: oriented }, vertices).dot(normal) < 0) [oriented[1], oriented[2]] = [oriented[2], oriented[1]];
  target.push(makeTriangle(oriented, materialIndex));
}

export function bevelFace(controller, factor = 0.12, depth = 0.08) {
  if (
    controller.selectionMode !== 'face'
    || controller.selectedFaces.size !== 1
    || !Number.isFinite(factor)
    || !Number.isFinite(depth)
    || factor <= 0
    || factor >= 0.5
  ) {
    controller.status('Bevel: выберите одну грань; factor 0..0.5');
    return false;
  }

  const group = controller.faceGroups[[...controller.selectedFaces][0]];
  const loop = orderBoundaryLoop(group?.boundary ?? []);
  if (!group || loop.length < 3) {
    controller.status('Bevel: нужна грань с простым замкнутым контуром');
    return false;
  }

  controller.editor.checkpoint('Bevel face');
  const vertices = cloneVertices(controller.vertices);
  const center = new THREE.Vector3();
  loop.forEach((id) => center.add(controller.vertices[id].position));
  center.multiplyScalar(1 / loop.length);

  const inner = loop.map((id) => {
    const newId = vertices.length;
    const position = controller.vertices[id].position
      .clone()
      .lerp(center, factor)
      .addScaledVector(group.normal, depth);
    vertices.push({ position, sources: [] });
    return newId;
  });

  const remove = new Set(group.triangles);
  const triangles = controller.triangles.filter((_, index) => !remove.has(index)).map(cloneTriangle);
  const materialIndex = controller.triangles[group.triangles[0]]?.materialIndex ?? 0;
  controller.vertices = vertices;
  triangles.push(...triangulateLoop(inner, group.normal, materialIndex, vertices));

  for (let i = 0; i < loop.length; i += 1) {
    const next = (i + 1) % loop.length;
    pushOriented(triangles, [loop[i], loop[next], inner[next]], group.normal, materialIndex, vertices);
    pushOriented(triangles, [loop[i], inner[next], inner[i]], group.normal, materialIndex, vertices);
  }

  controller.rebuildMesh(triangles);
  controller.status(`Bevel Face · factor ${factor} · depth ${depth}`);
  return true;
}
