import * as THREE from 'three';
import { attributesForTriangle, faceAttributeMaps, interpolateTuple } from './attributes.js';
import {
  cloneTriangle,
  edgeKey,
  makeTriangle,
  orderBoundaryLoop,
  triangleNormal,
  triangulateLoop,
} from './topology.js';
import { InteractionOverlay, circle, cross, line } from '../runtime/interaction-overlay.js';

const SNAP_EPSILON = 1e-4;

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
}

function language() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

function nearestPointOnEdge(point, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  if (lengthSq < 1e-12) return { t: 0, point: a.clone(), distanceSq: point.distanceToSquared(a) };
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(point, a).dot(ab) / lengthSq, 0, 1);
  const projected = a.clone().addScaledVector(ab, t);
  return { t, point: projected, distanceSq: point.distanceToSquared(projected) };
}

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

function orientedSplitTriangle(source, a, b, cutId, vertices, factor) {
  const third = source.v.find((id) => id !== a && id !== b);
  if (third === undefined) return [];
  const normal = triangleNormal(source, vertices);
  const uvMap = new Map();
  source.v.forEach((id, corner) => uvMap.set(id, source.uv[corner].clone()));
  uvMap.set(cutId, uvMap.get(a).clone().lerp(uvMap.get(b), factor));

  const attrMaps = {};
  for (const [name, corners] of Object.entries(source.attrs ?? {})) {
    const map = new Map();
    source.v.forEach((id, corner) => map.set(id, [...corners[corner]]));
    map.set(cutId, interpolateTuple(map.get(a), map.get(b), factor));
    attrMaps[name] = map;
  }

  const result = [[a, cutId, third], [cutId, b, third]];
  return result.map((rawIds) => {
    const ids = [...rawIds];
    if (triangleNormal({ v: ids }, vertices).dot(normal) < 0) [ids[1], ids[2]] = [ids[2], ids[1]];
    const uv = ids.map((id) => {
      const value = uvMap.get(id) ?? new THREE.Vector2();
      return [value.x, value.y];
    });
    return makeTriangle(ids, source.materialIndex ?? 0, uv, attributesForTriangle(ids, attrMaps));
  });
}

export class KnifeTool {
  constructor(editor, editMode, onStatus = null) {
    this.editor = editor;
    this.editMode = editMode;
    this.onStatus = onStatus ?? ((message) => editMode.status(message));
    this.active = false;
    this.start = null;
    this.hover = null;
    this.lastPointer = null;
    this.overlay = new InteractionOverlay();
    this.hoverFrame = 0;
    this.pendingPointer = null;

    window.addEventListener('pointermove', (event) => {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (!this.active) return;
      this.pendingPointer = event;
      if (this.hoverFrame) return;
      this.hoverFrame = requestAnimationFrame(() => {
        this.hoverFrame = 0;
        const pending = this.pendingPointer;
        this.pendingPointer = null;
        if (pending && this.active) this.updateHover(pending);
      });
    }, { capture: true });
  }

  begin() {
    if (!this.editMode.active) {
      this.onStatus(language() === 'en' ? 'Knife: enter Edit Mode first' : 'Knife: сначала войдите в Edit Mode');
      return false;
    }
    if (this.editMode.selectionMode !== 'face') this.editMode.setSelectionMode('face');
    this.active = true;
    this.start = null;
    this.hover = null;
    this.editor.transform.detach();
    this.renderOverlay();
    this.onStatus(language() === 'en'
      ? 'Knife · choose the first point on a face boundary'
      : 'Knife · выберите первую точку на границе грани');
    return true;
  }

  cancel(silent = false) {
    if (!this.active) return false;
    this.active = false;
    this.start = null;
    this.hover = null;
    this.pendingPointer = null;
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    this.overlay.hide();
    this.editMode.updatePivot();
    if (!silent) this.onStatus(language() === 'en' ? 'Knife cancelled' : 'Knife отменён');
    return true;
  }

  pointerHit(event) {
    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    this.editor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.editor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.editor.raycaster.setFromCamera(this.editor.pointer, this.editor.camera);
    const hit = this.editor.raycaster.intersectObject(this.editMode.selectionSurface(), false)[0];
    if (!hit) return null;
    const triangleId = this.editMode.triangleForHit(hit);
    const groupId = triangleId >= 0 ? this.editMode.triangleToFaceGroup[triangleId] : -1;
    const group = this.editMode.faceGroups[groupId];
    if (!group) return null;
    const localPoint = this.editMode.mesh.worldToLocal(hit.point.clone());
    const snap = this.snapToBoundary(group, localPoint);
    return snap ? { ...snap, groupId } : null;
  }

  updateHover(event) {
    if (!this.active) return;
    this.hover = this.pointerHit(event);
    this.renderOverlay();
  }

  project(localPoint) {
    const mesh = this.editMode.mesh;
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    const world = localPoint.clone().applyMatrix4(mesh.matrixWorld);
    const ndc = world.project(this.editor.camera);
    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - ndc.y) * 0.5 * rect.height,
      visible: ndc.z >= -1.2 && ndc.z <= 1.2,
    };
  }

  renderOverlay() {
    if (!this.active) {
      this.overlay.hide();
      return;
    }
    const pointer = this.lastPointer ?? (() => {
      const rect = this.editor.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })();
    let svg = cross(pointer.x, pointer.y, { radius: 7, color: '#f59b23', opacity: 0.75 });

    if (this.start?.point) {
      const start = this.project(this.start.point);
      if (start?.visible) svg += circle(start.x, start.y, { radius: 5, color: '#66c7ff', fill: '#66c7ff', opacity: 0.95 });
    }
    if (this.hover?.point) {
      const hover = this.project(this.hover.point);
      if (hover?.visible) {
        const validSecond = !this.start || (this.start.groupId === this.hover.groupId && this.start.edge.key !== this.hover.edge.key);
        const color = validSecond ? '#f59b23' : '#ef5b5b';
        svg += circle(hover.x, hover.y, { radius: 5, color, fill: color, opacity: 0.95 });
        if (this.start?.point) {
          const start = this.project(this.start.point);
          if (start?.visible) svg += line(start.x, start.y, hover.x, hover.y, { color, width: 2, opacity: 0.9, dash: validSecond ? '' : '4 4' });
        }
      }
    }

    const en = language() === 'en';
    const title = this.start ? (en ? 'Knife · End point' : 'Нож · Конечная точка') : (en ? 'Knife · Start point' : 'Нож · Начальная точка');
    let value = en ? 'Hover a boundary edge' : 'Наведите на граничное ребро';
    if (this.hover) value = this.start ? (en ? 'Click to cut' : 'Кликните для разреза') : (en ? 'Click to set start' : 'Кликните, чтобы поставить начало');
    const hint = en ? 'LMB set point · Esc cancel' : 'ЛКМ поставить точку · Esc отменить';
    this.overlay.show({ x: pointer.x, y: pointer.y, title, value, hint, svg });
  }

  handlePointerUp(event) {
    if (!this.active) return false;
    if (!this.editor.pointerStart || this.editor.transform.dragging) return true;
    const dx = event.clientX - this.editor.pointerStart.x;
    const dy = event.clientY - this.editor.pointerStart.y;
    this.editor.pointerStart = null;
    if (Math.hypot(dx, dy) > 4) return true;

    const snap = this.pointerHit(event);
    this.hover = snap;
    if (!snap) {
      this.renderOverlay();
      this.onStatus(language() === 'en' ? 'Knife · hover the editable face boundary' : 'Knife · наведите на границу редактируемой грани');
      return true;
    }

    if (!this.start) {
      this.start = snap;
      this.renderOverlay();
      this.onStatus(language() === 'en'
        ? 'Knife · start set, choose another edge on the same face'
        : 'Knife · начало установлено, выберите другое ребро этой же грани');
      return true;
    }
    if (this.start.groupId !== snap.groupId) {
      this.renderOverlay();
      this.onStatus(language() === 'en' ? 'Knife · second point must be on the same logical face' : 'Knife · вторая точка должна быть на той же логической грани');
      return true;
    }
    if (this.start.edge.key === snap.edge.key) {
      this.renderOverlay();
      this.onStatus(language() === 'en' ? 'Knife · choose another boundary edge' : 'Knife · выберите другое граничное ребро');
      return true;
    }

    const success = this.commitSegment(this.start, snap);
    if (success) {
      this.active = false;
      this.start = null;
      this.hover = null;
      this.overlay.hide();
      this.onStatus(language() === 'en' ? 'Knife · segment created' : 'Knife · сегмент создан');
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
    const uvMap = faceUvMap(group, controller.triangles);
    const attrMaps = faceAttributeMaps(group, controller.triangles);
    const cuts = [];
    for (const snap of [start, end]) {
      let vertexId;
      if (snap.t <= SNAP_EPSILON) vertexId = snap.edge.a;
      else if (snap.t >= 1 - SNAP_EPSILON) vertexId = snap.edge.b;
      else {
        vertexId = vertices.length;
        vertices.push({ position: snap.point.clone(), sources: [] });
        const uvA = uvMap.get(snap.edge.a) ?? new THREE.Vector2();
        const uvB = uvMap.get(snap.edge.b) ?? new THREE.Vector2();
        uvMap.set(vertexId, uvA.clone().lerp(uvB, snap.t));
        for (const map of Object.values(attrMaps)) {
          map.set(vertexId, interpolateTuple(map.get(snap.edge.a), map.get(snap.edge.b), snap.t));
        }
      }
      cuts.push({ ...snap, vertexId });
    }
    if (cuts[0].vertexId === cuts[1].vertexId) {
      this.onStatus(language() === 'en' ? 'Knife · start and end are identical' : 'Knife · начало и конец совпадают');
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
      this.onStatus(language() === 'en' ? 'Knife · segment does not split the face' : 'Knife · сегмент не делит грань на две области');
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
          this.onStatus(language() === 'en'
            ? 'Knife · neighboring face is too complex for a safe cut'
            : 'Knife · соседняя грань слишком сложная для безопасного разреза');
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
    triangles.push(...triangulateLoop(polygonA, group.normal, materialIndex, vertices, uvMap, attrMaps));
    triangles.push(...triangulateLoop(polygonB, group.normal, materialIndex, vertices, uvMap, attrMaps));

    for (const [triangleId, cut] of externalSplits) {
      const source = controller.triangles[triangleId];
      triangles.push(...orientedSplitTriangle(source, cut.edge.a, cut.edge.b, cut.vertexId, vertices, cut.t));
    }

    controller.rebuildMesh(triangles);
    return true;
  }
}
