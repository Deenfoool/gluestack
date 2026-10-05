import * as THREE from 'three';
import { bevelFace } from './bevel.js';
import { loopCut } from './cuts.js';

const TYPES = Object.freeze({
  extrude: { label: 'Extrude Faces', history: 'Extrude faces' },
  inset: { label: 'Inset Face', history: 'Inset face' },
  bevel: { label: 'Bevel Face', history: 'Bevel face' },
  loopCut: { label: 'Loop Cut', history: 'Loop cut' },
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    this.suppressClick = false;
    this.pointerFrame = 0;
    this.pendingPointer = null;

    window.addEventListener('pointermove', (event) => {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (!this.state) return;
      this.pendingPointer = {
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
      };
      if (this.pointerFrame) return;
      this.pointerFrame = requestAnimationFrame(() => {
        this.pointerFrame = 0;
        const pointer = this.pendingPointer;
        this.pendingPointer = null;
        if (this.state && pointer) this.updateFromPointer(pointer);
      });
    }, { capture: true });

    window.addEventListener('pointerdown', (event) => {
      if (!this.state) return;
      const viewportClick = Boolean(event.target.closest?.('#viewport'));
      if (event.button === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.flushPointerPreview();
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
      const handled = this.handleKey(event);
      if (handled || this.state) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true });
  }

  get active() { return Boolean(this.state); }

  flushPointerPreview() {
    if (this.pointerFrame) {
      cancelAnimationFrame(this.pointerFrame);
      this.pointerFrame = 0;
    }
    const pointer = this.pendingPointer;
    this.pendingPointer = null;
    if (this.state && pointer) this.updateFromPointer(pointer);
  }

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
    const baseGeometry = this.editMode.mesh.geometry.clone();
    const orbitEnabled = this.editor.orbit.enabled;
    const baseValues = type === 'extrude'
      ? { distance: 0 }
      : type === 'inset'
        ? { factor: 0.001 }
        : type === 'loopCut'
          ? { factor: 0.5 }
          : { factor: 0.001, depth: 0 };

    this.editor.beginHistory(TYPES[type].history);
    this.editor.orbit.enabled = false;
    this.editor.transform.detach();
    this.state = {
      type,
      mesh: this.editMode.mesh,
      baseGeometry,
      selection,
      startX: pointer.x,
      startY: pointer.y,
      scale: sceneScale(this.editMode.mesh),
      orbitEnabled,
      values: baseValues,
      previewApplied: false,
      numeric: '',
    };
    this.renderHud();
    this.status(language() === 'en'
      ? `${this.label()} · move the mouse · LMB/Enter apply · RMB/Esc cancel`
      : `${this.label()} · двигайте мышь · ЛКМ/Enter применить · ПКМ/Esc отменить`);
    return true;
  }

  label() {
    return this.labelFor(this.state?.type);
  }

  labelFor(type) {
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
    this.renderHud();
    return s.previewApplied;
  }

  updateFromPointer(event) {
    const s = this.state;
    if (!s) return;
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
      let factor = 0.001 + Math.abs(dx) * 0.0015;
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
    if (event.key === 'Enter') { this.flushPointerPreview(); this.commit(); return true; }
    if (event.key === 'Backspace') {
      this.state.numeric = this.state.numeric.slice(0, -1);
      if (this.state.numeric) this.applyNumeric();
      this.renderHud();
      return true;
    }
    if (/^[0-9]$/.test(event.key)) this.state.numeric += event.key;
    else if ((event.key === '.' || event.key === ',') && !this.state.numeric.includes('.')) this.state.numeric += '.';
    else if (event.key === '-' && !this.state.numeric) this.state.numeric = '-';
    else return false;
    this.applyNumeric();
    this.renderHud();
    return true;
  }

  renderHud() {
    if (!this.state || !this.hud) return;
    const s = this.state;
    let value = '';
    if (s.type === 'extrude') value = `${s.values.distance.toFixed(3)}`;
    else if (s.type === 'inset' || s.type === 'loopCut') value = `${s.values.factor.toFixed(3)}`;
    else value = `factor ${s.values.factor.toFixed(3)} · depth ${s.values.depth.toFixed(3)}`;
    const hint = language() === 'en'
      ? 'LMB/Enter ✓ · RMB/Esc ✕ · Shift precision · Ctrl snap'
      : 'ЛКМ/Enter ✓ · ПКМ/Esc ✕ · Shift точно · Ctrl шаг';
    this.hud.textContent = `${this.label()} · ${value} · ${hint}`;
    this.hud.hidden = false;
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
    this.hud.hidden = true;
    this.editor.commitHistory();
    this.editor.events.onStructure();
    this.editMode.emitChange();
    this.editMode.updatePivot();
    this.status(language() === 'en' ? `${TYPES[s.type].label}: applied` : `${this.labelFor(s.type)}: применено`);
    return true;
  }

  cancel() {
    const s = this.state;
    if (!s) return false;
    if (this.pointerFrame) cancelAnimationFrame(this.pointerFrame);
    this.pointerFrame = 0;
    this.pendingPointer = null;
    this.restoreBase();
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    s.baseGeometry.dispose();
    this.hud.hidden = true;
    this.editor.cancelHistory();
    this.editMode.refreshOverlay();
    this.editMode.updatePivot();
    this.status(language() === 'en' ? `${TYPES[s.type].label}: cancelled` : `${this.labelFor(s.type)}: отменено`);
    return true;
  }
}
