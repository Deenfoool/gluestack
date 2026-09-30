import * as THREE from 'three';
import {
  boundaryEdgesForTriangles,
  cloneTriangle,
  orderBoundaryLoop,
  triangleNormal,
  triangulateLoop,
} from './topology.js';

function averageNormal(triangleIds, triangles, vertices) {
  const normal = new THREE.Vector3();
  for (const id of triangleIds) normal.add(triangleNormal(triangles[id], vertices));
  if (normal.lengthSq() < 1e-10) normal.set(0, 1, 0);
  return normal.normalize();
}

export function dissolveSelected(controller) {
  if (controller.selectionMode === 'vertex') {
    if (controller.selectedVertices.size !== 1) {
      controller.status('Dissolve Vertex: выберите одну вершину');
      return false;
    }
    const vertexId = [...controller.selectedVertices][0];
    const incident = new Set();
    controller.triangles.forEach((triangle, index) => {
      if (triangle.v.includes(vertexId)) incident.add(index);
    });
    if (incident.size < 3) {
      controller.status('Dissolve Vertex: нужна замкнутая окрестность');
      return false;
    }
    const loop = orderBoundaryLoop(boundaryEdgesForTriangles(controller.triangles, incident));
    if (loop.length < 3 || loop.includes(vertexId)) {
      controller.status('Dissolve Vertex: открытая или сложная топология не поддерживается');
      return false;
    }
    const materials = new Set([...incident].map((id) => controller.triangles[id].materialIndex ?? 0));
    if (materials.size !== 1) {
      controller.status('Dissolve Vertex: соседние полигоны должны иметь один material slot');
      return false;
    }

    controller.editor.checkpoint('Dissolve vertex');
    const triangles = controller.triangles.filter((_, index) => !incident.has(index)).map(cloneTriangle);
    triangles.push(...triangulateLoop(
      loop,
      averageNormal(incident, controller.triangles, controller.vertices),
      [...materials][0],
      controller.vertices,
    ));
    controller.rebuildMesh(triangles);
    controller.status('Вершина растворена');
    return true;
  }

  if (controller.selectionMode === 'edge') {
    if (controller.selectedEdges.size !== 1) {
      controller.status('Dissolve Edge: выберите одно внутреннее ребро');
      return false;
    }
    const selectedKey = [...controller.selectedEdges][0];
    const edge = controller.edges.find((item) => item.key === selectedKey);
    if (!edge || edge.triangles.length !== 2) {
      controller.status('Dissolve Edge: нужно внутреннее ребро между двумя треугольниками');
      return false;
    }
    const [aIndex, bIndex] = edge.triangles;
    const a = controller.triangles[aIndex];
    const b = controller.triangles[bIndex];
    if ((a.materialIndex ?? 0) !== (b.materialIndex ?? 0)) {
      controller.status('Dissolve Edge: material slot должен совпадать');
      return false;
    }
    if (triangleNormal(a, controller.vertices).dot(triangleNormal(b, controller.vertices)) < 0.999) {
      controller.status('Dissolve Edge: базовая версия работает на почти плоской паре');
      return false;
    }

    const pair = new Set([aIndex, bIndex]);
    let loop = orderBoundaryLoop(boundaryEdgesForTriangles(controller.triangles, pair));
    if (loop.length !== 4) {
      controller.status('Dissolve Edge: пара не образует простой quad');
      return false;
    }
    const endpoints = new Set([edge.a, edge.b]);
    const rotateFrom = loop.findIndex((id) => !endpoints.has(id));
    if (rotateFrom > 0) loop = [...loop.slice(rotateFrom), ...loop.slice(0, rotateFrom)];

    controller.editor.checkpoint('Dissolve edge');
    const triangles = controller.triangles.filter((_, index) => !pair.has(index)).map(cloneTriangle);
    triangles.push(...triangulateLoop(loop, triangleNormal(a, controller.vertices), a.materialIndex ?? 0, controller.vertices));
    controller.rebuildMesh(triangles);
    controller.status('Ребро растворено и quad перетриангулирован');
    return true;
  }

  controller.status('Dissolve: используйте Vertex или Edge Select');
  return false;
}
