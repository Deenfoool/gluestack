import * as THREE from 'three';
import {
  cloneTriangle,
  edgeKey,
  orderBoundaryLoop,
  triangleNormal,
  triangulateLoop,
} from './topology.js';

const SNAP_EPSILON = 1e-4;

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
}

function nearestPointOnEdge(point, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  if (lengthSq < 1e-12) return { t: 0, point: a.clone(), distanceSq: point.distanceToSquared(a) };
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(point, a).dot(ab) / lengthSq, 0, 1);
  const projected = a.clone().addScaledVector(ab, t);
  return { t, point: projected, distanceSq: point.distanceToSquared(projected) };
}

function orientedSplitTriangle(source, a, b, cutId, vertices) {
  const third = source.v.find((id) => id !== a && id !== b);
  if (third === undefined) return [];
  const normal = triangleNormal(source, vertices);
  const result = [[a, cutId, third], [cutId, b, third]];
  for (const ids of result) {
    if (triangleNormal({ v: ids }, vertices).dot(normal) < 0) [ids[1], ids[2]] = [ids[2], ids[1]];
  }
  return result.map((ids) => ({
    v: ids,
    uv: ids.map(() => new THREE.Vector2()),
    materialIndex: source.materialIndex ?? 0,
  }));
}

export class KnifeTool {
  constructor(editor, editMode, onStatus = null) {
    this.editor = editor;
    this.editMode = editMode;
    this.onStatus = onStatus ?? ((message) => editMode.status(message));
    this.active = false;
    this.start = null;
  }

  begin() {
    if (!this.editMode.active) {
      this.onStatus('Knife: сначала войдите в Edit Mode');
      return false;
    }
    if (this.editMode.selectionMode !== 'face') this.editMode.setSelectionMode('face');
    this.active = true;
    this.start = null;
    this.editor.transform.detach();
    this.onStatus('Knife · кликните начало разреза на границе грани · Esc отмена');
    return true;
  }

  cancel(silent = false) {
    if (!this.active) return false;
    this.active = false;
    this.start = null;
    this.editMode.updatePivot();
    if (!silent) this.onStatus('Knife отменён');
    return true;
  }

  handlePointerUp(event) {
    if (!this.active) return false;
    if (!this.editor.pointerStart || this.editor.transform.dragging) return true;
    const dx = event.clientX - this.editor.pointerStart.x;
    const dy = event.clientY - this.editor.pointerStart.y;
    this.editor.pointerStart = null;
    if (Math.hypot(dx, dy) > 4) return true;

    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    this.editor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.editor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.editor.raycaster.setFromCamera(this.editor.pointer, this.editor.camera);
    const hit = this.editor.raycaster.intersectObject(this.editMode.mesh, false)[0];
    if (!hit) {
      this.onStatus('Knife · кликните по редактируемой грани');
      return true;
    }

    const triangleId = this.editMode.sourceFaceToTriangle[hit.faceIndex];
    const groupId = triangleId >= 0 ? this.editMode.triangleToFaceGroup[triangleId] : -1;
    const group = this.editMode.faceGroups[groupId];
    if (!group) {
      this.onStatus('Knife · грань не определена');
      return true;
    }

    const localPoint = this.editMode.mesh.worldToLocal(hit.point.clone());
    const snap = this.snapToBoundary(group, localPoint);
    if (!snap) {
      this.onStatus('Knife · не удалось найти граничное ребро');
      return true;
    }

    if (!this.start) {
      this.start = { ...snap, groupId };
      this.onStatus('Knife · начало установлено, кликните конец на другом ребре этой же грани');
      return true;
    }
    if (this.start.groupId !== groupId) {
      this.onStatus('Knife · второй клик должен быть на той же логической грани');
      return true;
    }
    if (this.start.edge.key === snap.edge.key) {
      this.onStatus('Knife · выберите другое граничное ребро');
      return true;
    }

    const success = this.commitSegment(this.start, { ...snap, groupId });
    if (success) {
      this.active = false;
      this.start = null;
      this.onStatus('Knife · сегмент создан');
    }
    return true;
  }

  snapToBoundary(group, point) {
    let best = null;
    for (const boundary of group.boundary) {
      const a = this.editMode.vertices[boundary.a]?.position;
      const b = this.editMode.vertices[boundary.b]?.position;
      if (!a || !b) continue;
      const projected = nearestPointOnEdge(point, a, b);
      if (!best || projected.distanceSq < best.distanceSq) {
        best = { edge: { ...boundary, key: edgeKey(boundary.a, boundary.b) }, ...projected };
      }
    }
    return best;
  }

  commitSegment(start, end) {
    const controller = this.editMode;
    const group = controller.faceGroups[start.groupId];
    let loop = orderBoundaryLoop(group?.boundary ?? []);
    if (!group || loop.length < 3) return false;

    const vertices = cloneVertices(controller.vertices);
    const cuts = [];
    for (const snap of [start, end]) {
      let vertexId;
      if (snap.t <= SNAP_EPSILON) vertexId = snap.edge.a;
      else if (snap.t >= 1 - SNAP_EPSILON) vertexId = snap.edge.b;
      else {
        vertexId = vertices.length;
        vertices.push({ position: snap.point.clone(), sources: [] });
      }
      cuts.push({ ...snap, vertexId });
    }
    if (cuts[0].vertexId === cuts[1].vertexId) {
      this.onStatus('Knife · начало и конец совпадают');
      return false;
    }

    const inserted = [];
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      inserted.push(a);
      const key = edgeKey(a, b);
      for (const cut of cuts) {
        if (cut.edge.key === key && cut.vertexId !== a && cut.vertexId !== b) inserted.push(cut.vertexId);
      }
    }
    loop = inserted;
    const first = loop.indexOf(cuts[0].vertexId);
    const second = loop.indexOf(cuts[1].vertexId);
    if (first < 0 || second < 0 || first === second) return false;

    const walk = (from, to) => {
      const path = [loop[from]];
      let cursor = from;
      while (cursor !== to && path.length <= loop.length + 1) {
        cursor = (cursor + 1) % loop.length;
        path.push(loop[cursor]);
      }
      return path;
    };
    const polygonA = walk(first, second);
    const polygonB = walk(second, first);
    if (polygonA.length < 3 || polygonB.length < 3) {
      this.onStatus('Knife · сегмент не делит грань на две области');
      return false;
    }

    const groupTriangles = new Set(group.triangles);
    const externalSplits = new Map();
    for (const cut of cuts) {
      if (cut.vertexId === cut.edge.a || cut.vertexId === cut.edge.b) continue;
      const topologyEdge = controller.edges.find((edge) => edge.key === cut.edge.key);
      for (const triangleId of topologyEdge?.triangles ?? []) {
        if (groupTriangles.has(triangleId)) continue;
        if (externalSplits.has(triangleId)) {
          this.onStatus('Knife · соседняя грань слишком сложная для безопасного разреза');
          return false;
        }
        externalSplits.set(triangleId, cut);
      }
    }

    controller.editor.checkpoint('Knife segment');
    const remove = new Set([...groupTriangles, ...externalSplits.keys()]);
    const triangles = controller.triangles.filter((_, index) => !remove.has(index)).map(cloneTriangle);
    controller.vertices = vertices;
    const materialIndex = controller.triangles[group.triangles[0]]?.materialIndex ?? 0;
    triangles.push(...triangulateLoop(polygonA, group.normal, materialIndex, vertices));
    triangles.push(...triangulateLoop(polygonB, group.normal, materialIndex, vertices));

    for (const [triangleId, cut] of externalSplits) {
      const source = controller.triangles[triangleId];
      triangles.push(...orientedSplitTriangle(source, cut.edge.a, cut.edge.b, cut.vertexId, vertices));
    }

    controller.rebuildMesh(triangles);
    return true;
  }
}
