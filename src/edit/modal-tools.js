import * as THREE from 'three';
import { bevelFace } from './bevel.js';
import { loopCut } from './cuts.js';
import { InteractionOverlay, circle, cross, line } from '../runtime/interaction-overlay.js';

const TYPES = Object.freeze({
  extrude: { label: 'Extrude Faces', history: 'Extrude faces' },
  inset: { label: 'Inset Face', history: 'Inset face' },
  bevel: { label: 'Bevel Face', history: 'Bevel face' },
  loopCut: { label: 'Loop Cut', history: 'Loop cut' },
});

const POSITION_EPSILON = 1e-5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positionKey(point) {
  return `${Math.round(point.x / POSITION_EPSILON)}:${Math.round(point.y / POSITION_EPSILON)}:${Math.round(point.z / POSITION_EPSILON)}`;
}

function cloneSelection(controller) {
  return {
    mode: controller.selectionMode,
    vertices: new Set(controller.selectedVertices),
    edges: new Set(controller.selectedEdges),
    faces: new Set(controller.selectedFaces),
  };
}

function restoreSelection(controller, selection) {
  controller.selectionMode = selection.mode;
  controller.selectedVertices = new Set([...selection.vertices].filter((id) => id >= 0 && id < controller.vertices.length));
  controller.selectedEdges = new Set([...selection.edges].filter((key) => controller.logicalEdges.some((edge) => edge.key === key)));
  controller.selectedFaces = new Set([...selection.faces].filter((id) => id >= 0 && id < controller.faceGroups.length));
}

function sceneScale(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3()).length();
  return Math.max(size / 260, 0.003);
}

function language() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

function average(points) {
  if (!points.length) return new THREE.Vector3();
  const result = new THREE.Vector3();
  points.forEach((point) => result.add(point));
  return result.multiplyScalar(1 / points.length);
}

function nearest(point, candidates) {
  let result = null;
  let best = Infinity;
  for (const candidate of candidates) {
    const distance = point.distanceToSquared(candidate);
    if (distance < best) {
      best = distance;
      result = candidate;
    }
  }
  return result;
}

export class EditModalTools {
  constructor({ editor, editMode, hud, status, transformModal = null, knifeTool = null }) {
    this.editor = editor;
    this.editMode = editMode;
    this.hud = hud;
    this.status = status;
    this.transformModal = transformModal;
    this.knifeTool = knifeTool;
    this.state = null;
    this.lastPointer = null;
    this.pendingPointer = null;
    this.previewFrame = 0;
    this.suppressClick = false;
    this.overlay = new InteractionOverlay();

    window.addEventListener('pointermove', (event) => {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (!this.state) return;
      this.pendingPointer = event;
      if (this.previewFrame) return;
      this.previewFrame = requestAnimationFrame(() => {
        this.previewFrame = 0;
        const pending = this.pendingPointer;
        this.pendingPointer = null;
        if (pending && this.state) this.updateFromPointer(pending);
      });
    }, { capture: true });

    window.addEventListener('pointerdown', (event) => {
      if (!this.state) return;
      this.flushPreview();
      const viewportClick = Boolean(event.target.closest?.('#viewport'));
      if (event.button === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.suppressClick = viewportClick;
        this.commit();
      } else if (event.button === 2) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.suppressClick = viewportClick;
        this.cancel();
      }
    }, { capture: true });

    window.addEventListener('click', (event) => {
      if (!this.suppressClick) return;
      this.suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

    window.addEventListener('contextmenu', (event) => {
      if (!this.state && !this.suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.suppressClick = false;
    }, { capture: true });

    window.addEventListener('keydown', (event) => {
      if (!this.state) return;
      this.handleKey(event);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }

  get active() { return Boolean(this.state); }

  preflight(type) {
    const c = this.editMode;
    const en = language() === 'en';
    if (!c.active || !c.mesh) {
      this.status(en ? 'This tool is available only in Edit Mode' : 'Инструмент доступен только в Edit Mode');
      return false;
    }
    if (type === 'extrude' && (c.selectionMode !== 'face' || !c.selectedFaces.size)) {
      this.status(en ? 'Extrude: select one or more faces' : 'Extrude: выберите одну или несколько граней');
      return false;
    }
    if ((type === 'inset' || type === 'bevel') && (c.selectionMode !== 'face' || c.selectedFaces.size !== 1)) {
      const name = type === 'inset' ? 'Inset' : 'Bevel';
      this.status(en ? `${name}: select one face` : `${name}: выберите одну грань`);
      return false;
    }
    if (type === 'loopCut' && (c.selectionMode !== 'edge' || c.selectedEdges.size !== 1)) {
      this.status(en ? 'Loop Cut: select one edge of a quad strip' : 'Loop Cut: выберите одно ребро quad-strip');
      return false;
    }
    return true;
  }

  begin(type) {
    if (!TYPES[type] || !this.preflight(type)) return false;
    if (this.state) this.cancel();
    if (this.transformModal?.state) this.transformModal.finishForModeSwitch();
    this.knifeTool?.cancel?.(true);

    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    const pointer = this.lastPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const selection = cloneSelection(this.editMode);
    const selectedIds = [...this.editMode.getSelectedVertexIds()];
    const baseSelectedPositions = selectedIds
      .map((id) => this.editMode.vertices[id]?.position?.clone())
      .filter(Boolean);
    const basePositionKeys = new Set(this.editMode.vertices.map((vertex) => positionKey(vertex.position)));
    const baseGeometry = this.editMode.mesh.geometry.clone();
    const orbitEnabled = this.editor.orbit.enabled;
    const baseValues = type === 'extrude'
      ? { distance: 0 }
      : type === 'inset'
        ? { factor: 0.001 }
        : type === 'loopCut'
          ? { factor: 0.5 }
          : { factor: 0.001, depth: 0 };

    const normal = new THREE.Vector3();
    if (selection.mode === 'face') {
      selection.faces.forEach((id) => {
        const value = this.editMode.faceGroups[id]?.normal;
        if (value) normal.add(value);
      });
    }
    if (normal.lengthSq() > 1e-10) normal.normalize();

    this.editor.beginHistory(TYPES[type].history);
    this.editor.orbit.enabled = false;
    this.editor.transform.detach();
    this.state = {
      type,
      mesh: this.editMode.mesh,
      baseGeometry,
      basePositionKeys,
      baseSelectedPositions,
      baseCenter: average(baseSelectedPositions),
      baseNormal: normal,
      selection,
      startX: pointer.x,
      startY: pointer.y,
      pointerX: pointer.x,
      pointerY: pointer.y,
      scale: sceneScale(this.editMode.mesh),
      orbitEnabled,
      values: baseValues,
      previewApplied: false,
      numeric: '',
    };

    if (type === 'loopCut') this.applyPreview();
    else this.renderVisuals();
    this.status(language() === 'en'
      ? `${this.label()} · move the mouse · LMB/Enter apply · RMB/Esc cancel`
      : `${this.label()} · двигайте мышь · ЛКМ/Enter применить · ПКМ/Esc отменить`);
    return true;
  }

  flushPreview() {
    if (this.previewFrame) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = 0;
    }
    const pending = this.pendingPointer;
    this.pendingPointer = null;
    if (pending && this.state) this.updateFromPointer(pending);
  }

  label(type = this.state?.type) {
    const raw = TYPES[type]?.label ?? 'Tool';
    return window.__gluestackI18n?.t?.(raw) ?? raw;
  }

  restoreBase() {
    const s = this.state;
    if (!s || !s.mesh?.parent || this.editMode.mesh !== s.mesh) return false;
    s.mesh.geometry.dispose();
    s.mesh.geometry = s.baseGeometry.clone();
    this.editMode.loadTopology();
    restoreSelection(this.editMode, s.selection);
    this.editMode.overlay.mount(s.mesh);
    this.editMode.refreshOverlay();
    this.editMode.updatePivot();
    this.editor.transform.detach();
    return true;
  }

  runSilent(callback) {
    const checkpoint = this.editor.checkpoint;
    const structure = this.editor.events.onStructure;
    const change = this.editMode.events.onChange;
    this.editor.checkpoint = () => {};
    this.editor.events.onStructure = () => {};
    this.editMode.events.onChange = () => {};
    try { return callback(); }
    finally {
      this.editor.checkpoint = checkpoint;
      this.editor.events.onStructure = structure;
      this.editMode.events.onChange = change;
    }
  }

  applyPreview() {
    const s = this.state;
    if (!s || !this.restoreBase()) return false;
    const ok = this.runSilent(() => {
      if (s.type === 'extrude') return this.editMode.extrude(s.values.distance);
      if (s.type === 'inset') return this.editMode.inset(s.values.factor);
      if (s.type === 'bevel') return bevelFace(this.editMode, s.values.factor, s.values.depth);
      if (s.type === 'loopCut') return loopCut(this.editMode, s.values.factor);
      return false;
    });
    s.previewApplied = Boolean(ok);
    this.editor.transform.detach();
    this.renderVisuals();
    return s.previewApplied;
  }

  updateFromPointer(event) {
    const s = this.state;
    if (!s) return;
    s.pointerX = event.clientX;
    s.pointerY = event.clientY;
    const precision = event.shiftKey ? 0.1 : 1;
    const dx = (event.clientX - s.startX) * precision;
    const dy = (event.clientY - s.startY) * precision;

    if (s.type === 'extrude') {
      let value = -dy * s.scale;
      if (event.ctrlKey) value = Math.round(value / 0.1) * 0.1;
      s.values.distance = value;
    } else if (s.type === 'inset') {
      let value = Math.abs(dx - dy) * 0.002;
      if (event.ctrlKey) value = Math.round(value * 20) / 20;
      s.values.factor = clamp(value, 0.001, 0.999);
    } else if (s.type === 'loopCut') {
      let value = 0.5 + dx * 0.0025;
      if (event.ctrlKey) value = Math.round(value * 20) / 20;
      s.values.factor = clamp(value, 0.001, 0.999);
    } else if (s.type === 'bevel') {
      let factor = Math.abs(dx) * 0.0015;
      let depth = -dy * s.scale * 0.5;
      if (event.ctrlKey) {
        factor = Math.round(factor * 20) / 20;
        depth = Math.round(depth / 0.05) * 0.05;
      }
      s.values.factor = clamp(factor, 0.001, 0.499);
      s.values.depth = depth;
    }
    s.numeric = '';
    this.applyPreview();
  }

  applyNumeric() {
    const s = this.state;
    if (!s || !s.numeric || s.numeric === '-' || s.numeric === '.') return false;
    const value = Number(s.numeric);
    if (!Number.isFinite(value)) return false;
    if (s.type === 'extrude') s.values.distance = value;
    else if (s.type === 'inset') s.values.factor = clamp(value, 0.001, 0.999);
    else if (s.type === 'loopCut') s.values.factor = clamp(value, 0.001, 0.999);
    else if (s.type === 'bevel') s.values.factor = clamp(value, 0.001, 0.499);
    return this.applyPreview();
  }

  handleKey(event) {
    if (!this.state) return false;
    if (event.key === 'Escape') { this.cancel(); return true; }
    if (event.key === 'Enter') { this.flushPreview(); this.commit(); return true; }
    if (event.key === 'Backspace') {
      this.state.numeric = this.state.numeric.slice(0, -1);
      if (this.state.numeric) this.applyNumeric();
      this.renderVisuals();
      return true;
    }
    if (/^[0-9]$/.test(event.key)) this.state.numeric += event.key;
    else if ((event.key === '.' || event.key === ',') && !this.state.numeric.includes('.')) this.state.numeric += '.';
    else if (event.key === '-' && !this.state.numeric) this.state.numeric = '-';
    else return false;
    this.applyNumeric();
    this.renderVisuals();
    return true;
  }

  project(localPoint) {
    const s = this.state;
    if (!s?.mesh) return null;
    s.mesh.updateWorldMatrix(true, false);
    const world = localPoint.clone().applyMatrix4(s.mesh.matrixWorld);
    const ndc = world.project(this.editor.camera);
    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - ndc.y) * 0.5 * rect.height,
      visible: ndc.z >= -1.2 && ndc.z <= 1.2,
    };
  }

  valueText() {
    const s = this.state;
    if (!s) return '';
    if (s.numeric) return s.numeric;
    const en = language() === 'en';
    if (s.type === 'extrude') return `${en ? 'Distance' : 'Расстояние'} ${s.values.distance.toFixed(3)}`;
    if (s.type === 'inset' || s.type === 'loopCut') return `${en ? 'Factor' : 'Коэффициент'} ${s.values.factor.toFixed(3)}`;
    return `${en ? 'Factor' : 'Коэффициент'} ${s.values.factor.toFixed(3)} · ${en ? 'Depth' : 'Глубина'} ${s.values.depth.toFixed(3)}`;
  }

  previewPoints() {
    const s = this.state;
    if (!s?.previewApplied) return [];
    return this.editMode.vertices
      .filter((vertex) => !s.basePositionKeys.has(positionKey(vertex.position)))
      .slice(0, 260)
      .map((vertex) => vertex.position);
  }

  renderVisuals() {
    const s = this.state;
    if (!s) return;
    let svg = '';
    svg += line(s.startX, s.startY, s.pointerX, s.pointerY, { color: '#f59b23', opacity: 0.34, dash: '4 5' });
    svg += cross(s.startX, s.startY, { color: '#66c7ff', opacity: 0.75 });

    const basePoints = s.baseSelectedPositions.slice(0, 220);
    for (const point of basePoints) {
      const screen = this.project(point);
      if (!screen?.visible) continue;
      svg += circle(screen.x, screen.y, { radius: 4, color: '#66c7ff', fill: 'rgba(102,199,255,.08)', opacity: 0.72 });
    }

    if (s.baseNormal.lengthSq() > 1e-8 && s.baseSelectedPositions.length) {
      const localLength = Math.max(s.scale * 70, 0.2);
      const a = this.project(s.baseCenter);
      const b = this.project(s.baseCenter.clone().addScaledVector(s.baseNormal, localLength));
      if (a?.visible && b?.visible) {
        svg += line(a.x, a.y, b.x, b.y, { color: '#66c7ff', width: 2, opacity: 0.78 });
        svg += circle(b.x, b.y, { radius: 3, color: '#66c7ff', fill: '#66c7ff', opacity: 0.9 });
      }
    }

    for (const point of this.previewPoints()) {
      const screen = this.project(point);
      if (!screen?.visible) continue;
      const base = nearest(point, basePoints);
      if (base) {
        const baseScreen = this.project(base);
        if (baseScreen?.visible) svg += line(baseScreen.x, baseScreen.y, screen.x, screen.y, { color: '#f59b23', opacity: 0.34, dash: '3 4' });
      }
      svg += circle(screen.x, screen.y, { radius: s.type === 'loopCut' ? 4.5 : 4, color: '#f59b23', fill: '#f59b23', opacity: 0.92 });
    }

    const en = language() === 'en';
    const hint = en
      ? 'LMB/Enter apply · RMB/Esc cancel · Shift precision · Ctrl snap'
      : 'ЛКМ/Enter применить · ПКМ/Esc отменить · Shift точно · Ctrl шаг';
    this.overlay.show({
      x: s.pointerX,
      y: s.pointerY,
      title: this.label(),
      value: this.valueText(),
      hint,
      svg,
    });
    if (this.hud) this.hud.hidden = true;
  }

  commit() {
    const s = this.state;
    if (!s) return false;
    if (!s.previewApplied) {
      this.cancel();
      return false;
    }
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    s.baseGeometry.dispose();
    this.overlay.hide();
    if (this.hud) this.hud.hidden = true;
    this.editor.commitHistory();
    this.editor.events.onStructure();
    this.editMode.emitChange();
    this.editMode.updatePivot();
    this.status(language() === 'en' ? `${TYPES[s.type].label}: applied` : `${this.label(s.type)}: применено`);
    return true;
  }

  cancel() {
    const s = this.state;
    if (!s) return false;
    this.pendingPointer = null;
    if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = 0;
    this.restoreBase();
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    s.baseGeometry.dispose();
    this.overlay.hide();
    if (this.hud) this.hud.hidden = true;
    this.editor.cancelHistory();
    this.editMode.refreshOverlay();
    this.editMode.updatePivot();
    this.status(language() === 'en' ? `${TYPES[s.type].label}: cancelled` : `${this.label(s.type)}: отменено`);
    return true;
  }
}
