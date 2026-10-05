import { syncLogicalPositions } from '../edit/topology.js';
import { InteractionOverlay, circle, line } from './interaction-overlay.js';

function language() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

function status(editMode, ru, en) {
  editMode.status(language() === 'en' ? en : ru);
}

function installHistoryLayerGuard(editor, editMode) {
  if (editor.__gluestackEditHistoryLayerGuard) return;
  const captureState = editor.captureState.bind(editor);
  editor.captureState = (...args) => {
    const mesh = editMode.active ? editMode.mesh : null;
    if (!mesh || !editMode.hiddenTriangles?.size) return captureState(...args);
    const previousMask = mesh.layers.mask;
    // glTF-loaded/editor-created meshes live on the default render layer. Hidden
    // component isolation is viewport-only and must never enter Undo snapshots.
    mesh.layers.set(0);
    try { return captureState(...args); }
    finally { mesh.layers.mask = previousMask; }
  };
  editor.__gluestackEditHistoryLayerGuard = true;
}

export class EditSlideTool {
  constructor({ editor, editMode }) {
    this.editor = editor;
    this.editMode = editMode;
    this.overlay = new InteractionOverlay();
    this.state = null;
    this.lastPointer = null;
    this.pending = null;
    this.frame = 0;
    installHistoryLayerGuard(editor, editMode);

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

    const selectedIds = [...c.getSelectedVertexIds()].filter((id) => !c.isVertexHidden?.(id));
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
