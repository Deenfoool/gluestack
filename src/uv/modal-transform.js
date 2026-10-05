import * as THREE from 'three';
import { InteractionOverlay, circle, cross, line } from '../runtime/interaction-overlay.js';

function language() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

export class UVModalTransform {
  constructor({ getController, hud, status }) {
    this.getController = getController;
    this.hud = hud;
    this.status = status;
    this.state = null;
    this.lastPointer = null;
    this.pendingPointer = null;
    this.previewFrame = 0;
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
        if (pending && this.state) this.previewFromPointer(pending);
      });
    }, { capture: true });

    window.addEventListener('pointerdown', (event) => {
      if (!this.state) return;
      this.flushPreview();
      if (event.button === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.commit();
      } else if (event.button === 2) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.cancel();
      }
    }, { capture: true });

    window.addEventListener('contextmenu', (event) => {
      if (!this.state) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

    window.addEventListener('keydown', (event) => {
      if (!this.state) return;
      this.handleKey(event);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }

  get active() { return Boolean(this.state); }

  label(type = this.state?.type) {
    const raw = type === 'move' ? 'Move' : type === 'rotate' ? 'Rotate' : 'Scale';
    return window.__gluestackI18n?.t?.(raw) ?? raw;
  }

  begin(type) {
    const controller = this.getController?.();
    const activeWorkspace = document.querySelector('.workspace-tab.active')?.dataset.workspace;
    if (!controller?.mesh || activeWorkspace !== 'uv') return false;
    if (!['move', 'rotate', 'scale'].includes(type)) return false;
    if (!controller.selected?.size) {
      this.status(language() === 'en' ? 'UV: select vertices, edges or an island first' : 'UV: сначала выберите вершины, рёбра или остров');
      return false;
    }
    if (this.state) this.cancel();
    const snapshot = controller.captureSelectedUVs();
    if (!snapshot.length) return false;
    const rect = controller.canvas.getBoundingClientRect();
    const pointer = this.lastPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const center = snapshot.reduce((sum, item) => sum.add(item.uv), new THREE.Vector2()).multiplyScalar(1 / snapshot.length);
    this.state = {
      type,
      controller,
      snapshot,
      center,
      startX: pointer.x,
      startY: pointer.y,
      pointerX: pointer.x,
      pointerY: pointer.y,
      numeric: '',
      value: type === 'move' ? new THREE.Vector2() : type === 'rotate' ? 0 : 1,
    };
    this.renderVisuals();
    this.status(language() === 'en'
      ? `UV ${this.label()} · move mouse · LMB/Enter apply · RMB/Esc cancel`
      : `UV ${this.label()} · двигайте мышь · ЛКМ/Enter применить · ПКМ/Esc отменить`);
    return true;
  }

  flushPreview() {
    if (this.previewFrame) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = 0;
    }
    const pending = this.pendingPointer;
    this.pendingPointer = null;
    if (pending && this.state) this.previewFromPointer(pending);
  }

  apply() {
    const s = this.state;
    if (!s) return;
    if (s.type === 'move') {
      const delta = s.value;
      s.controller.applyCapturedTransform(s.snapshot, (uv) => uv.add(delta));
    } else if (s.type === 'rotate') {
      const angle = THREE.MathUtils.degToRad(s.value);
      const cos = Math.cos(angle); const sin = Math.sin(angle);
      s.controller.applyCapturedTransform(s.snapshot, (uv) => {
        const x = uv.x - s.center.x; const y = uv.y - s.center.y;
        return new THREE.Vector2(s.center.x + x * cos - y * sin, s.center.y + x * sin + y * cos);
      });
    } else {
      s.controller.applyCapturedTransform(s.snapshot, (uv) => uv.sub(s.center).multiplyScalar(s.value).add(s.center));
    }
    this.renderVisuals();
  }

  previewFromPointer(event) {
    const s = this.state;
    if (!s) return;
    s.pointerX = event.clientX;
    s.pointerY = event.clientY;
    const precision = event.shiftKey ? 0.1 : 1;
    const dx = (event.clientX - s.startX) * precision;
    if (s.type === 'move') {
      const rect = s.controller.canvas.getBoundingClientRect();
      const a = s.controller.screenToUV(s.startX - rect.left, s.startY - rect.top);
      const b = s.controller.screenToUV(event.clientX - rect.left, event.clientY - rect.top);
      s.value = b.sub(a).multiplyScalar(precision);
      if (event.ctrlKey) {
        s.value.x = Math.round(s.value.x * 20) / 20;
        s.value.y = Math.round(s.value.y * 20) / 20;
      }
    } else if (s.type === 'rotate') {
      let value = dx * 0.5;
      if (event.ctrlKey) value = Math.round(value / 5) * 5;
      s.value = value;
    } else {
      let value = Math.exp(dx * 0.01);
      if (event.ctrlKey) value = Math.round(value * 10) / 10;
      s.value = Math.max(0.001, value);
    }
    s.numeric = '';
    this.apply();
  }

  applyNumeric() {
    const s = this.state;
    if (!s || !s.numeric || s.numeric === '-' || s.numeric === '.') return;
    const value = Number(s.numeric);
    if (!Number.isFinite(value)) return;
    if (s.type === 'move') s.value = new THREE.Vector2(value, 0);
    else if (s.type === 'rotate') s.value = value;
    else s.value = Math.max(0.001, value);
    this.apply();
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

  uvScreen(uv) {
    const s = this.state;
    if (!s) return null;
    const rect = s.controller.canvas.getBoundingClientRect();
    const local = s.controller.uvToScreen(uv);
    return { x: rect.left + local.x, y: rect.top + local.y };
  }

  valueText() {
    const s = this.state;
    if (!s) return '';
    if (s.numeric) return s.numeric;
    if (s.type === 'move') return `Δ ${s.value.x.toFixed(3)}, ${s.value.y.toFixed(3)}`;
    if (s.type === 'rotate') return `${s.value.toFixed(1)}°`;
    return `${s.value.toFixed(3)}×`;
  }

  renderVisuals() {
    const s = this.state;
    if (!s) return;
    const uvAttr = s.controller.mesh?.geometry.getAttribute('uv');
    let svg = '';
    svg += line(s.startX, s.startY, s.pointerX, s.pointerY, { color: '#f59b23', opacity: 0.34, dash: '4 5' });
    svg += cross(s.startX, s.startY, { color: '#66c7ff', opacity: 0.75 });

    for (const item of s.snapshot.slice(0, 320)) {
      const original = this.uvScreen(item.uv);
      if (!original) continue;
      svg += circle(original.x, original.y, { radius: 4, color: '#66c7ff', fill: 'rgba(102,199,255,.08)', opacity: 0.78 });
      if (!uvAttr || item.id >= uvAttr.count) continue;
      const currentUV = new THREE.Vector2().fromBufferAttribute(uvAttr, item.id);
      const current = this.uvScreen(currentUV);
      svg += line(original.x, original.y, current.x, current.y, { color: '#f59b23', opacity: 0.34, dash: '3 4' });
      svg += circle(current.x, current.y, { radius: 4, color: '#f59b23', fill: '#f59b23', opacity: 0.94 });
    }

    const center = this.uvScreen(s.center);
    if (center) svg += cross(center.x, center.y, { radius: 7, color: '#f59b23', opacity: 0.9 });

    const en = language() === 'en';
    const hint = en
      ? 'LMB/Enter apply · RMB/Esc cancel · Shift precision · Ctrl snap'
      : 'ЛКМ/Enter применить · ПКМ/Esc отменить · Shift точно · Ctrl шаг';
    this.overlay.show({
      x: s.pointerX,
      y: s.pointerY,
      title: `UV ${this.label()}`,
      value: this.valueText(),
      hint,
      svg,
    });
    if (this.hud) this.hud.hidden = true;
  }

  commit() {
    const s = this.state;
    if (!s) return false;
    this.state = null;
    this.overlay.hide();
    if (this.hud) this.hud.hidden = true;
    s.controller.editor.commitHistory();
    s.controller.rebuildTopology();
    s.controller.render();
    s.controller.status(`UV ${this.label(s.type)}`);
    return true;
  }

  cancel() {
    const s = this.state;
    if (!s) return false;
    this.pendingPointer = null;
    if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = 0;
    s.controller.applyCapturedTransform(s.snapshot, (uv) => uv);
    this.state = null;
    this.overlay.hide();
    if (this.hud) this.hud.hidden = true;
    s.controller.editor.cancelHistory();
    s.controller.rebuildTopology();
    s.controller.render();
    s.controller.status(language() === 'en' ? 'UV transform cancelled' : 'UV-трансформация отменена');
    return true;
  }
}
