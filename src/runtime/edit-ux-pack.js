import * as THREE from 'three';
import { cloneTriangle, edgeKey, rebuildMeshGeometry, syncLogicalPositions } from '../edit/topology.js';
import { InteractionOverlay, circle, line } from './interaction-overlay.js';

const DUPLICATE_EPSILON = 4e-5;

function language() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

function status(editMode, ru, en) {
  editMode.status(language() === 'en' ? en : ru);
}

function logicalEdgeMap(editMode) {
  return new Map(editMode.logicalEdges.map((edge) => [edge.key, edge]));
}

function triangleKeys(triangle) {
  return [
    edgeKey(triangle.v[0], triangle.v[1]),
    edgeKey(triangle.v[1], triangle.v[2]),
    edgeKey(triangle.v[2], triangle.v[0]),
  ];
}

function selectedTriangleIds(editMode) {
  if (editMode.selectionMode === 'face') return new Set(editMode.getSelectedTriangleIds());
  if (editMode.selectionMode === 'vertex') {
    const selected = editMode.selectedVertices;
    return new Set(editMode.triangles
      .map((triangle, index) => triangle.v.every((id) => selected.has(id)) ? index : -1)
      .filter((index) => index >= 0));
  }
  const selected = editMode.selectedEdges;
  return new Set(editMode.triangles
    .map((triangle, index) => triangleKeys(triangle).every((key) => selected.has(key)) ? index : -1)
    .filter((index) => index >= 0));
}

function touchedTriangleIds(editMode) {
  if (editMode.selectionMode === 'face') return new Set(editMode.getSelectedTriangleIds());
  if (editMode.selectionMode === 'vertex') {
    return new Set(editMode.triangles
      .map((triangle, index) => triangle.v.some((id) => editMode.selectedVertices.has(id)) ? index : -1)
      .filter((index) => index >= 0));
  }
  return new Set(editMode.triangles
    .map((triangle, index) => triangleKeys(triangle).some((key) => editMode.selectedEdges.has(key)) ? index : -1)
    .filter((index) => index >= 0));
}

function edgeGroups(editMode) {
  const map = new Map();
  for (const group of editMode.faceGroups) {
    for (const edge of group.boundary ?? []) {
      if (!map.has(edge.key)) map.set(edge.key, new Set());
      map.get(edge.key).add(group.id);
    }
  }
  return map;
}

function vertexEdges(editMode) {
  const map = new Map();
  for (const edge of editMode.logicalEdges) {
    if (editMode.isEdgeHidden?.(edge)) continue;
    if (!map.has(edge.a)) map.set(edge.a, []);
    if (!map.has(edge.b)) map.set(edge.b, []);
    map.get(edge.a).push(edge);
    map.get(edge.b).push(edge);
  }
  return map;
}

function collectEdgeLoop(editMode, seedKey) {
  const byKey = logicalEdgeMap(editMode);
  const seed = byKey.get(seedKey);
  if (!seed || editMode.isEdgeHidden?.(seed)) return new Set();
  const byVertex = vertexEdges(editMode);
  const byGroup = edgeGroups(editMode);
  const result = new Set([seedKey]);

  function sharesFace(aKey, bKey) {
    const a = byGroup.get(aKey) ?? new Set();
    const b = byGroup.get(bKey) ?? new Set();
    for (const id of a) if (b.has(id)) return true;
    return false;
  }

  function walk(startEdge, startVertex) {
    let current = startEdge;
    let vertex = startVertex;
    const visited = new Set([`${current.key}@${vertex}`]);
    for (let guard = 0; guard < editMode.logicalEdges.length + 2; guard += 1) {
      const candidates = (byVertex.get(vertex) ?? []).filter((edge) => (
        edge.key !== current.key
        && !result.has(edge.key)
        && !sharesFace(current.key, edge.key)
      ));
      if (candidates.length !== 1) break;
      const next = candidates[0];
      result.add(next.key);
      const nextVertex = next.a === vertex ? next.b : next.a;
      const step = `${next.key}@${nextVertex}`;
      if (visited.has(step)) break;
      visited.add(step);
      current = next;
      vertex = nextVertex;
    }
  }

  walk(seed, seed.a);
  walk(seed, seed.b);
  return result;
}

function makeVisualGeometry(editMode, hiddenTriangles) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const groups = [];
  let currentMaterial = null;
  let groupStart = 0;
  let writtenTriangles = 0;

  editMode.triangles.forEach((triangle, triangleIndex) => {
    if (hiddenTriangles.has(triangleIndex)) return;
    const materialIndex = triangle.materialIndex ?? 0;
    if (currentMaterial !== materialIndex) {
      if (currentMaterial !== null) groups.push({
        start: groupStart,
        count: writtenTriangles * 3 - groupStart,
        materialIndex: currentMaterial,
      });
      currentMaterial = materialIndex;
      groupStart = writtenTriangles * 3;
    }
    triangle.v.forEach((vertexId, corner) => {
      const point = editMode.vertices[vertexId].position;
      positions.push(point.x, point.y, point.z);
      const uv = triangle.uv?.[corner] ?? new THREE.Vector2();
      uvs.push(uv.x, uv.y);
    });
    writtenTriangles += 1;
  });
  if (currentMaterial !== null) groups.push({
    start: groupStart,
    count: writtenTriangles * 3 - groupStart,
    materialIndex: currentMaterial,
  });

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  groups.forEach((group) => geometry.addGroup(group.start, group.count, group.materialIndex));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function cloneInvisibleMaterial(material) {
  const clone = material?.clone?.() ?? new THREE.MeshBasicMaterial();
  clone.transparent = true;
  clone.opacity = 0;
  clone.colorWrite = false;
  clone.depthWrite = false;
  return clone;
}

function createSeparatedMesh(editMode, triangleIds, suffix) {
  const source = editMode.mesh;
  const editor = editMode.editor;
  const triangles = [...triangleIds].sort((a, b) => a - b).map((id) => cloneTriangle(editMode.triangles[id]));
  const material = Array.isArray(source.material) ? [...source.material] : source.material;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = editor.uniqueName(`${source.name || 'Mesh'}_${suffix}`);
  mesh.position.copy(source.position);
  mesh.quaternion.copy(source.quaternion);
  mesh.scale.copy(source.scale);
  mesh.matrixAutoUpdate = source.matrixAutoUpdate;
  mesh.userData = structuredClone(source.userData ?? {});
  delete mesh.userData.gluestackId;
  rebuildMeshGeometry(mesh, editMode.vertices, triangles, editMode.attributeState);
  (source.parent ?? editor.modelRoot).add(mesh);
  editor.assignIds(mesh, true);
  return mesh;
}

function connectedTriangleComponents(editMode) {
  const byVertex = new Map();
  editMode.triangles.forEach((triangle, index) => {
    triangle.v.forEach((vertexId) => {
      if (!byVertex.has(vertexId)) byVertex.set(vertexId, []);
      byVertex.get(vertexId).push(index);
    });
  });
  const unseen = new Set(editMode.triangles.map((_, index) => index));
  const components = [];
  while (unseen.size) {
    const start = unseen.values().next().value;
    const component = new Set();
    const queue = [start];
    unseen.delete(start);
    while (queue.length) {
      const current = queue.pop();
      component.add(current);
      for (const vertexId of editMode.triangles[current].v) {
        for (const next of byVertex.get(vertexId) ?? []) {
          if (!unseen.has(next)) continue;
          unseen.delete(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.size - a.size);
}

class EditSlideTool {
  constructor({ editor, editMode }) {
    this.editor = editor;
    this.editMode = editMode;
    this.overlay = new InteractionOverlay();
    this.state = null;
    this.lastPointer = null;
    this.pending = null;
    this.frame = 0;

    window.addEventListener('pointermove', (event) => {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (!this.state) return;
      this.pending = event;
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const pending = this.pending;
        this.pending = null;
        if (pending && this.state) this.update(pending);
      });
    }, { capture: true });

    window.addEventListener('pointerdown', (event) => {
      if (!this.state) return;
      if (event.button === 0) this.commit();
      else if (event.button === 2) this.cancel();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

    window.addEventListener('contextmenu', (event) => {
      if (!this.state) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

    window.addEventListener('keydown', (event) => {
      if (!this.state) return;
      if (event.key === 'Escape') this.cancel();
      else if (event.key === 'Enter') this.commit();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }

  get active() { return Boolean(this.state); }

  project(point) {
    const mesh = this.editMode.mesh;
    mesh.updateWorldMatrix(true, false);
    const ndc = point.clone().applyMatrix4(mesh.matrixWorld).project(this.editor.camera);
    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - ndc.y) * 0.5 * rect.height,
    };
  }

  begin(kind) {
    const c = this.editMode;
    if (!c.active || !c.mesh) return false;
    if (kind === 'vertex' && (c.selectionMode !== 'vertex' || !c.selectedVertices.size)) {
      status(c, 'Vertex Slide: выберите вершины', 'Vertex Slide: select vertices');
      return false;
    }
    if (kind === 'edge' && (c.selectionMode !== 'edge' || !c.selectedEdges.size)) {
      status(c, 'Edge Slide: выберите рёбра', 'Edge Slide: select edges');
      return false;
    }

    const selectedIds = [...c.getSelectedVertexIds()];
    const selectedSet = new Set(selectedIds);
    const adjacency = new Map(selectedIds.map((id) => [id, []]));
    for (const edge of c.logicalEdges) {
      if (c.isEdgeHidden?.(edge)) continue;
      if (selectedSet.has(edge.a) && !selectedSet.has(edge.b)) adjacency.get(edge.a).push(edge.b);
      if (selectedSet.has(edge.b) && !selectedSet.has(edge.a)) adjacency.get(edge.b).push(edge.a);
    }
    if (![...adjacency.values()].some((items) => items.length)) {
      status(c, 'Slide: у выделения нет доступных соседних рёбер', 'Slide: selection has no available neighboring edges');
      return false;
    }

    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    const pointer = this.lastPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const base = new Map(selectedIds.map((id) => [id, c.vertices[id].position.clone()]));
    this.editor.beginHistory(kind === 'vertex' ? 'Vertex Slide' : 'Edge Slide');
    const orbitEnabled = this.editor.orbit.enabled;
    this.editor.orbit.enabled = false;
    this.editor.transform.detach();
    this.state = {
      kind,
      selectedIds,
      adjacency,
      base,
      chosen: new Map(),
      startX: pointer.x,
      startY: pointer.y,
      pointerX: pointer.x,
      pointerY: pointer.y,
      factor: 0,
      orbitEnabled,
    };
    this.render();
    status(c,
      `${kind === 'vertex' ? 'Vertex' : 'Edge'} Slide · двигайте мышь · ЛКМ применить · ПКМ/Esc отменить`,
      `${kind === 'vertex' ? 'Vertex' : 'Edge'} Slide · move mouse · LMB apply · RMB/Esc cancel`);
    return true;
  }

  update(event) {
    const s = this.state;
    if (!s) return;
    s.pointerX = event.clientX;
    s.pointerY = event.clientY;
    const precision = event.shiftKey ? 0.1 : 1;
    const mx = (event.clientX - s.startX) * precision;
    const my = (event.clientY - s.startY) * precision;
    let factorSum = 0;
    let factorCount = 0;
    s.chosen.clear();

    for (const id of s.selectedIds) {
      const origin = s.base.get(id);
      const originScreen = this.project(origin);
      let best = null;
      for (const neighborId of s.adjacency.get(id) ?? []) {
        const target = this.editMode.vertices[neighborId]?.position;
        if (!target) continue;
        const targetScreen = this.project(target);
        const ex = targetScreen.x - originScreen.x;
        const ey = targetScreen.y - originScreen.y;
        const lengthSq = ex * ex + ey * ey;
        if (lengthSq < 1e-4) continue;
        const projection = (mx * ex + my * ey) / lengthSq;
        const score = Math.abs(projection);
        if (!best || score > best.score) best = { neighborId, target, projection, score };
      }
      if (!best) continue;
      let factor = Math.min(1, Math.max(0, Math.abs(best.projection)));
      if (event.ctrlKey) factor = Math.round(factor * 10) / 10;
      this.editMode.vertices[id].position.copy(origin).lerp(best.target, factor);
      s.chosen.set(id, { targetId: best.neighborId, factor });
      factorSum += factor;
      factorCount += 1;
    }

    s.factor = factorCount ? factorSum / factorCount : 0;
    syncLogicalPositions(this.editMode.mesh, this.editMode.vertices);
    this.editMode.refreshOverlay();
    this.editor.transform.detach();
    this.render();
  }

  render() {
    const s = this.state;
    if (!s) return;
    let svg = '';
    for (const id of s.selectedIds.slice(0, 180)) {
      const origin = s.base.get(id);
      const current = this.editMode.vertices[id]?.position;
      if (!origin || !current) continue;
      const a = this.project(origin);
      const b = this.project(current);
      const chosen = s.chosen.get(id);
      if (chosen) {
        const target = this.editMode.vertices[chosen.targetId]?.position;
        if (target) {
          const t = this.project(target);
          svg += line(a.x, a.y, t.x, t.y, { color: '#6cc7ff', opacity: 0.42, dash: '4 4' });
        }
      }
      svg += circle(a.x, a.y, { radius: 4, color: '#bcbcbc', opacity: 0.65 });
      svg += line(a.x, a.y, b.x, b.y, { color: '#f59b23', opacity: 0.82 });
      svg += circle(b.x, b.y, { radius: 4.5, color: '#f59b23', fill: '#f59b23', opacity: 0.9 });
    }
    const en = language() === 'en';
    this.overlay.show({
      x: s.pointerX,
      y: s.pointerY,
      title: s.kind === 'vertex' ? 'Vertex Slide' : 'Edge Slide',
      value: `${en ? 'Factor' : 'Коэффициент'} ${s.factor.toFixed(3)}`,
      hint: en ? 'Shift precision · Ctrl snap · LMB apply · Esc cancel' : 'Shift точно · Ctrl шаг · ЛКМ применить · Esc отменить',
      svg,
    });
  }

  finishCommon() {
    const s = this.state;
    if (!s) return null;
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    this.overlay.hide();
    this.editMode.rebuildTopologyOnly();
    this.editMode.refreshOverlay();
    this.editMode.updatePivot();
    this.editMode.emitChange();
    return s;
  }

  commit() {
    if (!this.state) return;
    this.finishCommon();
    this.editor.commitHistory();
    status(this.editMode, 'Slide применён', 'Slide applied');
  }

  cancel() {
    const s = this.state;
    if (!s) return;
    for (const [id, point] of s.base) if (this.editMode.vertices[id]) this.editMode.vertices[id].position.copy(point);
    syncLogicalPositions(this.editMode.mesh, this.editMode.vertices);
    this.finishCommon();
    this.editor.cancelHistory();
    status(this.editMode, 'Slide отменён', 'Slide cancelled');
  }
}

export function installEditUXPack({ editor, editMode, transformModal = null }) {
  if (!editor || !editMode) return null;
  if (editMode.editUX) return editMode.editUX;

  const hiddenTriangles = new Set();
  let proxy = null;
  let originalMaterial = null;
  let invisibleMaterial = null;
  const baseRefreshOverlay = editMode.refreshOverlay.bind(editMode);
  const baseRebuildMesh = editMode.rebuildMesh.bind(editMode);
  const baseExit = editMode.exit.bind(editMode);
  const baseSelectAll = editMode.selectAll.bind(editMode);

  function clearSurfaceMask() {
    if (editMode.mesh && originalMaterial) editMode.mesh.material = originalMaterial;
    originalMaterial = null;
    if (proxy) {
      proxy.parent?.remove(proxy);
      proxy.geometry?.dispose?.();
      proxy = null;
    }
    const items = Array.isArray(invisibleMaterial) ? invisibleMaterial : invisibleMaterial ? [invisibleMaterial] : [];
    items.forEach((material) => material.dispose?.());
    invisibleMaterial = null;
  }

  function refreshSurfaceMask() {
    const mesh = editMode.mesh;
    if (!mesh || !editMode.active || !hiddenTriangles.size) {
      clearSurfaceMask();
      return;
    }
    if (!originalMaterial) {
      originalMaterial = mesh.material;
      invisibleMaterial = Array.isArray(originalMaterial)
        ? originalMaterial.map(cloneInvisibleMaterial)
        : cloneInvisibleMaterial(originalMaterial);
      mesh.material = invisibleMaterial;
    }
    if (!proxy) {
      proxy = new THREE.Mesh(new THREE.BufferGeometry(), originalMaterial);
      proxy.name = '__gluestack_hidden_surface_proxy';
      proxy.matrixAutoUpdate = false;
      proxy.raycast = () => {};
      editor.scene.add(proxy);
    }
    proxy.geometry.dispose();
    proxy.geometry = makeVisualGeometry(editMode, hiddenTriangles);
    proxy.material = originalMaterial;
    mesh.updateWorldMatrix(true, false);
    proxy.matrix.copy(mesh.matrixWorld);
    proxy.matrixWorld.copy(mesh.matrixWorld);
    proxy.visible = true;
  }

  editMode.hiddenTriangles = hiddenTriangles;
  editMode.isTriangleHidden = (index) => hiddenTriangles.has(index);
  editMode.isVertexHidden = (vertexId) => {
    const incident = [];
    editMode.triangles.forEach((triangle, index) => {
      if (triangle.v.includes(vertexId)) incident.push(index);
    });
    return incident.length > 0 && incident.every((index) => hiddenTriangles.has(index));
  };
  editMode.isEdgeHidden = (edgeOrKey) => {
    const edge = typeof edgeOrKey === 'string'
      ? editMode.logicalEdges.find((item) => item.key === edgeOrKey)
      : edgeOrKey;
    return Boolean(edge?.triangles?.length) && edge.triangles.every((index) => hiddenTriangles.has(index));
  };

  editMode.refreshOverlay = function refreshOverlayWithHidden() {
    if (!this.active) return;
    this.overlay.refresh({
      vertices: this.vertices,
      edges: this.logicalEdges,
      triangles: this.triangles,
      triangleToFaceGroup: this.triangleToFaceGroup,
      selectionMode: this.selectionMode,
      selectedVertices: this.getSelectedVertexIds(),
      selectedEdges: this.selectedEdges,
      selectedTriangles: this.getSelectedTriangleIds(),
      hiddenTriangles,
    });
    refreshSurfaceMask();
  };

  editMode.rebuildMesh = (triangles) => {
    hiddenTriangles.clear();
    clearSurfaceMask();
    return baseRebuildMesh(triangles);
  };

  editMode.exit = (...args) => {
    hiddenTriangles.clear();
    clearSurfaceMask();
    return baseExit(...args);
  };

  editMode.selectAll = () => {
    baseSelectAll();
    if (editMode.selectionMode === 'vertex') {
      for (const id of [...editMode.selectedVertices]) if (editMode.isVertexHidden(id)) editMode.selectedVertices.delete(id);
    } else if (editMode.selectionMode === 'edge') {
      for (const key of [...editMode.selectedEdges]) if (editMode.isEdgeHidden(key)) editMode.selectedEdges.delete(key);
    } else {
      for (const id of [...editMode.selectedFaces]) {
        const group = editMode.faceGroups[id];
        if (group?.triangles?.every((index) => hiddenTriangles.has(index))) editMode.selectedFaces.delete(id);
      }
    }
    editMode.refreshOverlay();
    editMode.updatePivot();
    editMode.emitChange();
  };

  function hideTriangles(ids, label) {
    ids.forEach((id) => hiddenTriangles.add(id));
    editMode.clearComponentSelection();
    editMode.refreshOverlay();
    editMode.updatePivot();
    editMode.emitChange();
    status(editMode, `${label} · скрыто ${hiddenTriangles.size} треугольников`, `${label} · ${hiddenTriangles.size} triangles hidden`);
    return true;
  }

  function hideSelected() {
    if (!editMode.active || !editMode.selectedCount()) return false;
    const ids = touchedTriangleIds(editMode);
    if (!ids.size) return false;
    return hideTriangles(ids, language() === 'en' ? 'Hide Selected' : 'Скрыть выделенное');
  }

  function hideUnselected() {
    if (!editMode.active || !editMode.selectedCount()) return false;
    const keep = touchedTriangleIds(editMode);
    const ids = new Set(editMode.triangles.map((_, index) => index).filter((index) => !keep.has(index)));
    return hideTriangles(ids, language() === 'en' ? 'Hide Unselected' : 'Скрыть невыделенное');
  }

  function unhide() {
    if (!hiddenTriangles.size) return false;
    hiddenTriangles.clear();
    clearSurfaceMask();
    editMode.refreshOverlay();
    editMode.emitChange();
    status(editMode, 'Вся геометрия снова видима', 'All geometry is visible');
    return true;
  }

  function selectEdgeLoopFrom(seedKey, additive = false) {
    if (!editMode.active || editMode.selectionMode !== 'edge') return false;
    const loop = collectEdgeLoop(editMode, seedKey);
    if (!loop.size) return false;
    if (!additive) editMode.selectedEdges.clear();
    loop.forEach((key) => editMode.selectedEdges.add(key));
    editMode.refreshOverlay();
    editMode.updatePivot();
    editMode.emitChange();
    status(editMode, `Edge Loop · ${loop.size} рёбер`, `Edge Loop · ${loop.size} edges`);
    return true;
  }

  function selectCurrentEdgeLoops() {
    if (!editMode.active || editMode.selectionMode !== 'edge' || !editMode.selectedEdges.size) {
      status(editMode, 'Edge Loop: сначала выберите ребро', 'Edge Loop: select an edge first');
      return false;
    }
    const seeds = [...editMode.selectedEdges];
    editMode.selectedEdges.clear();
    seeds.forEach((key) => collectEdgeLoop(editMode, key).forEach((loopKey) => editMode.selectedEdges.add(loopKey)));
    editMode.refreshOverlay();
    editMode.updatePivot();
    editMode.emitChange();
    status(editMode, `Edge Loop · ${editMode.selectedEdges.size} рёбер`, `Edge Loop · ${editMode.selectedEdges.size} edges`);
    return true;
  }

  function duplicateGeometry() {
    if (!editMode.active || !editMode.selectedCount()) return false;
    const chosen = selectedTriangleIds(editMode);
    if (!chosen.size) {
      status(editMode,
        'Duplicate Geometry: выделение должно содержать целые грани',
        'Duplicate Geometry: selection must contain complete faces');
      return false;
    }
    editor.checkpoint('Duplicate geometry');
    hiddenTriangles.clear();
    clearSurfaceMask();

    const vertices = editMode.vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [...(vertex.sources ?? [])] }));
    const used = new Set();
    chosen.forEach((triangleIndex) => editMode.triangles[triangleIndex].v.forEach((id) => used.add(id)));
    const duplicate = new Map();
    const worldRight = new THREE.Vector3(1, 0, 0).applyQuaternion(editor.camera.quaternion).normalize();
    const localRight = worldRight.transformDirection(editMode.mesh.matrixWorld.clone().invert()).normalize().multiplyScalar(DUPLICATE_EPSILON);
    for (const id of used) {
      duplicate.set(id, vertices.length);
      vertices.push({ position: editMode.vertices[id].position.clone().add(localRight), sources: [] });
    }

    const oldCount = editMode.triangles.length;
    const triangles = editMode.triangles.map(cloneTriangle);
    for (const triangleIndex of [...chosen].sort((a, b) => a - b)) {
      const triangle = cloneTriangle(editMode.triangles[triangleIndex]);
      triangle.v = triangle.v.map((id) => duplicate.get(id));
      triangles.push(triangle);
    }
    editMode.vertices = vertices;
    editMode.rebuildMesh(triangles);
    editMode.selectionMode = 'face';
    editMode.clearComponentSelection();
    for (let index = oldCount; index < editMode.triangles.length; index += 1) {
      const groupId = editMode.triangleToFaceGroup[index];
      if (groupId >= 0) editMode.selectedFaces.add(groupId);
    }
    editMode.refreshOverlay();
    editMode.updatePivot();
    editMode.emitChange();
    status(editMode, `Дублировано граней: ${chosen.size}`, `Duplicated faces: ${chosen.size}`);
    queueMicrotask(() => transformModal?.begin?.('translate'));
    return true;
  }

  function separateSelection() {
    const chosen = selectedTriangleIds(editMode);
    if (!chosen.size) {
      status(editMode, 'Separate Selection: выберите целые грани', 'Separate Selection: select complete faces');
      return false;
    }
    if (chosen.size >= editMode.triangles.length) {
      status(editMode, 'Separate Selection: нельзя отделить всю геометрию', 'Separate Selection: cannot separate the entire mesh');
      return false;
    }
    editor.checkpoint('Separate selection');
    createSeparatedMesh(editMode, chosen, 'Selection');
    const remain = editMode.triangles.filter((_, index) => !chosen.has(index)).map(cloneTriangle);
    editMode.rebuildMesh(remain);
    editor.events.onStructure();
    status(editMode, `Separate Selection · ${chosen.size} треугольников`, `Separate Selection · ${chosen.size} triangles`);
    return true;
  }

  function separateByMaterial() {
    const groups = new Map();
    editMode.triangles.forEach((triangle, index) => {
      const material = triangle.materialIndex ?? 0;
      if (!groups.has(material)) groups.set(material, new Set());
      groups.get(material).add(index);
    });
    const parts = [...groups.entries()].sort((a, b) => b[1].size - a[1].size);
    if (parts.length < 2) {
      status(editMode, 'Separate by Material: у mesh только один material slot', 'Separate by Material: mesh uses only one material slot');
      return false;
    }
    editor.checkpoint('Separate by material');
    const [, keep] = parts[0];
    for (const [material, ids] of parts.slice(1)) createSeparatedMesh(editMode, ids, `Material_${material}`);
    const remain = [...keep].sort((a, b) => a - b).map((id) => cloneTriangle(editMode.triangles[id]));
    editMode.rebuildMesh(remain);
    editor.events.onStructure();
    status(editMode, `Separate by Material · объектов создано: ${parts.length - 1}`, `Separate by Material · created objects: ${parts.length - 1}`);
    return true;
  }

  function separateLooseParts() {
    const components = connectedTriangleComponents(editMode);
    if (components.length < 2) {
      status(editMode, 'Separate Loose Parts: mesh уже связный', 'Separate Loose Parts: mesh is already connected');
      return false;
    }
    editor.checkpoint('Separate loose parts');
    const keep = components[0];
    components.slice(1).forEach((ids, index) => createSeparatedMesh(editMode, ids, `Part_${index + 2}`));
    const remain = [...keep].sort((a, b) => a - b).map((id) => cloneTriangle(editMode.triangles[id]));
    editMode.rebuildMesh(remain);
    editor.events.onStructure();
    status(editMode, `Separate Loose Parts · объектов создано: ${components.length - 1}`, `Separate Loose Parts · created objects: ${components.length - 1}`);
    return true;
  }

  const slide = new EditSlideTool({ editor, editMode });

  const api = {
    hiddenTriangles,
    hideSelected,
    hideUnselected,
    unhide,
    selectEdgeLoopFrom,
    selectCurrentEdgeLoops,
    duplicateGeometry,
    separateSelection,
    separateByMaterial,
    separateLooseParts,
    vertexSlide: () => slide.begin('vertex'),
    edgeSlide: () => slide.begin('edge'),
    slide,
    refreshSurfaceMask,
  };
  editMode.editUX = api;

  function menuLabel(key) {
    const en = language() === 'en';
    const labels = {
      loop: en ? 'Select Edge Loop' : 'Выбрать Edge Loop',
      hide: en ? 'Hide Selected' : 'Скрыть выделенное',
      hideOther: en ? 'Hide Unselected' : 'Скрыть невыделенное',
      unhide: en ? 'Unhide All' : 'Показать всё',
      duplicate: en ? 'Duplicate Geometry' : 'Дублировать геометрию',
      vertexSlide: 'Vertex Slide',
      edgeSlide: 'Edge Slide',
      separateSelection: en ? 'Separate · Selection' : 'Отделить · Выделение',
      separateMaterial: en ? 'Separate · By Material' : 'Отделить · По материалу',
      separateLoose: en ? 'Separate · Loose Parts' : 'Отделить · Несвязанные части',
    };
    return labels[key];
  }

  function mountMenu() {
    const host = document.querySelector('#mesh-menu .menu-popover');
    if (!host) return;
    host.querySelector('[data-edit-ux-block]')?.remove();
    const block = document.createElement('div');
    block.dataset.editUxBlock = '';
    block.innerHTML = `
      <div class="menu-separator"></div>
      <button type="button" data-edit-ux="loop"><i data-lucide="workflow"></i><span>${menuLabel('loop')}</span><kbd>Alt L</kbd></button>
      <button type="button" data-edit-ux="hide"><i data-lucide="eye-off"></i><span>${menuLabel('hide')}</span><kbd>H</kbd></button>
      <button type="button" data-edit-ux="hideOther"><i data-lucide="scan-eye"></i><span>${menuLabel('hideOther')}</span><kbd>Shift H</kbd></button>
      <button type="button" data-edit-ux="unhide"><i data-lucide="eye"></i><span>${menuLabel('unhide')}</span><kbd>Alt H</kbd></button>
      <div class="menu-separator"></div>
      <button type="button" data-edit-ux="duplicate"><i data-lucide="copy-plus"></i><span>${menuLabel('duplicate')}</span><kbd>Shift D</kbd></button>
      <button type="button" data-edit-ux="vertexSlide"><i data-lucide="move-horizontal"></i><span>${menuLabel('vertexSlide')}</span><kbd>Shift V</kbd></button>
      <button type="button" data-edit-ux="edgeSlide"><i data-lucide="move-horizontal"></i><span>${menuLabel('edgeSlide')}</span><kbd>Shift E</kbd></button>
      <div class="menu-separator"></div>
      <button type="button" data-edit-ux="separateSelection"><i data-lucide="scissors"></i><span>${menuLabel('separateSelection')}</span><kbd>P</kbd></button>
      <button type="button" data-edit-ux="separateMaterial"><i data-lucide="layers"></i><span>${menuLabel('separateMaterial')}</span></button>
      <button type="button" data-edit-ux="separateLoose"><i data-lucide="boxes"></i><span>${menuLabel('separateLoose')}</span></button>`;
    host.appendChild(block);
    window.__gluestackIcons8Tools?.scan?.();
    window.lucide?.createIcons?.();
  }

  function runAction(name) {
    if (!editMode.active) return false;
    const actions = {
      loop: selectCurrentEdgeLoops,
      hide: hideSelected,
      hideOther: hideUnselected,
      unhide,
      duplicate: duplicateGeometry,
      vertexSlide: api.vertexSlide,
      edgeSlide: api.edgeSlide,
      separateSelection,
      separateMaterial: separateByMaterial,
      separateLoose: separateLooseParts,
    };
    const fn = actions[name];
    return fn ? fn() : false;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-edit-ux]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelector('#mesh-menu')?.removeAttribute('open');
    runAction(button.dataset.editUx);
  }, { capture: true });

  window.addEventListener('keydown', (event) => {
    if (!editMode.active || slide.active || window.__gluestackHome?.visible) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    let handled = false;
    if (event.code === 'KeyH' && event.altKey) handled = unhide();
    else if (event.code === 'KeyH' && event.shiftKey) handled = hideUnselected();
    else if (event.code === 'KeyH' && !event.ctrlKey && !event.metaKey) handled = hideSelected();
    else if (event.code === 'KeyD' && event.shiftKey && !event.ctrlKey && !event.metaKey) handled = duplicateGeometry();
    else if (event.code === 'KeyV' && event.shiftKey && !event.ctrlKey && !event.metaKey) handled = api.vertexSlide();
    else if (event.code === 'KeyE' && event.shiftKey && !event.ctrlKey && !event.metaKey) handled = api.edgeSlide();
    else if (event.code === 'KeyL' && event.altKey && !event.ctrlKey && !event.metaKey) handled = selectCurrentEdgeLoops();
    else if (event.code === 'KeyP' && !event.altKey && !event.ctrlKey && !event.metaKey) handled = separateSelection();
    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });

  // When hidden geometry exists, filter Face Select ray hits against the hidden set.
  editor.renderer.domElement.addEventListener('pointerup', (event) => {
    if (!editMode.active || editMode.selectionMode !== 'face' || !hiddenTriangles.size || editor.transform.dragging) return;
    if (!editor.pointerStart) return;
    const dx = event.clientX - editor.pointerStart.x;
    const dy = event.clientY - editor.pointerStart.y;
    if (Math.hypot(dx, dy) > 5 || editor.transform.axis) return;
    const rect = editor.renderer.domElement.getBoundingClientRect();
    editor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    editor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    editor.raycaster.setFromCamera(editor.pointer, editor.camera);
    const hit = editor.raycaster.intersectObject(editMode.mesh, false).find((item) => {
      const internal = editMode.sourceFaceToTriangle[item.faceIndex];
      return internal >= 0 && !hiddenTriangles.has(internal);
    });
    const internal = hit ? editMode.sourceFaceToTriangle[hit.faceIndex] : -1;
    const group = internal >= 0 ? editMode.triangleToFaceGroup[internal] : null;
    editor.pointerStart = null;
    editMode.selectComponent(group >= 0 ? group : null, event.shiftKey);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });

  window.addEventListener('gluestack:language-changed', mountMenu);
  mountMenu();
  return api;
}
