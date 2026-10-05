import * as THREE from 'three';
import { syncLogicalPositions } from './edit/topology.js';
import { InteractionOverlay, circle, cross, line } from './runtime/interaction-overlay.js';

const DEG2RAD = Math.PI / 180;
const AXIS_COLORS = { x: '#ef5b5b', y: '#5bcf78', z: '#5d8dff' };

function language() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

function label(mode) {
  const raw = mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale';
  return window.__gluestackI18n?.t?.(raw) ?? raw;
}

function worldPerPixel(editor, worldPoint) {
  const rect = editor.renderer.domElement.getBoundingClientRect();
  const distance = Math.max(0.01, editor.camera.position.distanceTo(worldPoint));
  const height = Math.max(1, rect.height);
  return (2 * distance * Math.tan(THREE.MathUtils.degToRad(editor.camera.fov) * 0.5)) / height;
}

function parentLocalPosition(object, worldPosition) {
  if (!object.parent) return worldPosition.clone();
  object.parent.updateWorldMatrix(true, false);
  return object.parent.worldToLocal(worldPosition.clone());
}

function parentLocalQuaternion(object, worldQuaternion) {
  if (!object.parent) return worldQuaternion.clone();
  const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
  return parentWorld.invert().multiply(worldQuaternion);
}

export class TransformModal {
  constructor(editor, editMode, hud, status, refresh) {
    this.editor = editor;
    this.editMode = editMode;
    this.hud = hud;
    this.status = status;
    this.refresh = refresh;
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
        if (pending && this.state) this.applyPointerPreview(pending);
      });
    }, { capture: true });

    window.addEventListener('pointerdown', (event) => {
      if (!this.state) return;
      this.flushPointerPreview();
      if (event.button === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.commit();
      } else if (event.button === 2) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.cancel(true);
      }
    }, { capture: true });

    window.addEventListener('contextmenu', (event) => {
      if (!this.state) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }

  historyLabel() {
    if (!this.state) return 'Transform';
    const { kind, mode } = this.state;
    if (kind === 'edit') {
      return mode === 'translate' ? 'Move components' : mode === 'rotate' ? 'Rotate components' : 'Scale components';
    }
    return mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale';
  }

  rebaseObjectSnapshot() {
    if (!this.state || this.state.kind !== 'object') return;
    this.state.starts = this.editor.getSelectedObjects().map((object) => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      worldPosition: object.getWorldPosition(new THREE.Vector3()),
      worldQuaternion: object.getWorldQuaternion(new THREE.Quaternion()),
    }));
    this.state.centerWorld = this.objectCenterWorld();
  }

  objectCenterWorld() {
    if (!this.state?.starts?.length) return new THREE.Vector3();
    const center = new THREE.Vector3();
    this.state.starts.forEach((start) => center.add(start.worldPosition));
    return center.multiplyScalar(1 / this.state.starts.length);
  }

  editCenterWorld() {
    if (!this.state?.snapshot?.length || !this.editMode.mesh) return new THREE.Vector3();
    this.editMode.mesh.updateWorldMatrix(true, false);
    const center = new THREE.Vector3();
    this.state.snapshot.forEach((item) => center.add(item.position.clone().applyMatrix4(this.editMode.mesh.matrixWorld)));
    return center.multiplyScalar(1 / this.state.snapshot.length);
  }

  ensureHistory() {
    if (!this.state || this.state.historyStarted) return;
    if (this.state.kind === 'object') this.rebaseObjectSnapshot();
    else {
      this.state.snapshot = this.editMode.captureSelectedPositions();
      this.state.centerWorld = this.editCenterWorld();
    }
    this.editor.beginHistory(this.historyLabel());
    this.state.historyStarted = true;
  }

  finishWithoutRevert({ silent = false } = {}) {
    if (!this.state) return;
    const s = this.state;
    if (s.historyStarted) this.editor.cancelHistory();
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    this.overlay.hide();
    this.hud.hidden = true;
    if (s.kind === 'edit') this.editMode.updatePivot();
    if (!silent) this.status(language() === 'en' ? 'Transform finished' : 'Трансформация завершена');
    this.refresh();
  }

  finishForModeSwitch() {
    if (!this.state) return;
    if (this.state.previewApplied) {
      this.commit({ silent: true });
      return;
    }
    this.finishWithoutRevert({ silent: true });
  }

  begin(mode) {
    if (this.state) this.finishForModeSwitch();
    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    const pointer = this.lastPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const orbitEnabled = this.editor.orbit.enabled;

    if (this.editMode.active) {
      const snapshot = this.editMode.captureSelectedPositions();
      if (!snapshot.length) {
        this.status(language() === 'en' ? 'Edit Mode: select components first' : 'Edit Mode: сначала выберите компоненты');
        return false;
      }
      this.state = {
        kind: 'edit',
        mode,
        axis: null,
        buffer: '',
        snapshot,
        centerWorld: new THREE.Vector3(),
        historyStarted: false,
        previewApplied: false,
        orbitEnabled,
        startX: pointer.x,
        startY: pointer.y,
        pointerX: pointer.x,
        pointerY: pointer.y,
        mouseValue: null,
      };
      this.state.centerWorld = this.editCenterWorld();
      this.editor.transform.detach();
    } else {
      if (!this.editor.selected) {
        this.status(language() === 'en' ? 'Select an object first' : 'Сначала выберите объект');
        return false;
      }
      const starts = this.editor.getSelectedObjects().map((object) => ({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
        worldPosition: object.getWorldPosition(new THREE.Vector3()),
        worldQuaternion: object.getWorldQuaternion(new THREE.Quaternion()),
      }));
      this.state = {
        kind: 'object',
        mode,
        axis: null,
        buffer: '',
        starts,
        centerWorld: new THREE.Vector3(),
        historyStarted: false,
        previewApplied: false,
        orbitEnabled,
        startX: pointer.x,
        startY: pointer.y,
        pointerX: pointer.x,
        pointerY: pointer.y,
        mouseValue: null,
      };
      this.state.centerWorld = this.objectCenterWorld();
    }

    this.editor.orbit.enabled = false;
    this.editor.setTransformMode(mode);
    this.render();
    return true;
  }

  flushPointerPreview() {
    if (this.previewFrame) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = 0;
    }
    const pending = this.pendingPointer;
    this.pendingPointer = null;
    if (pending && this.state) this.applyPointerPreview(pending);
  }

  resetPreview() {
    if (!this.state || !this.state.previewApplied) return;
    if (this.state.kind === 'edit') {
      this.state.snapshot.forEach((item) => {
        if (this.editMode.vertices[item.id]) this.editMode.vertices[item.id].position.copy(item.position);
      });
      syncLogicalPositions(this.editMode.mesh, this.editMode.vertices);
      this.editMode.refreshOverlay();
      this.editMode.updatePivot();
      this.state.previewApplied = false;
      return;
    }
    for (const start of this.state.starts) {
      start.object.position.copy(start.position);
      start.object.quaternion.copy(start.quaternion);
      start.object.scale.copy(start.scale);
      start.object.updateMatrix();
      start.object.updateMatrixWorld(true);
    }
    this.state.previewApplied = false;
    this.editor.updateSelectionBoxes();
    this.editor.events.onTransform(this.editor.selected);
  }

  cameraBasis() {
    return {
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(this.editor.camera.quaternion).normalize(),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(this.editor.camera.quaternion).normalize(),
      forward: this.editor.camera.getWorldDirection(new THREE.Vector3()).normalize(),
    };
  }

  axisVector() {
    const axis = this.state?.axis;
    if (axis === 'x') return new THREE.Vector3(1, 0, 0);
    if (axis === 'y') return new THREE.Vector3(0, 1, 0);
    if (axis === 'z') return new THREE.Vector3(0, 0, 1);
    return null;
  }

  pointerTransform(event) {
    const s = this.state;
    const precision = event.shiftKey ? 0.1 : 1;
    const dx = (event.clientX - s.startX) * precision;
    const dy = (event.clientY - s.startY) * precision;
    const basis = this.cameraBasis();
    const units = worldPerPixel(this.editor, s.centerWorld);
    const axis = this.axisVector();

    if (s.mode === 'translate') {
      let delta;
      if (axis) {
        let amount = (dx - dy) * units;
        if (event.ctrlKey) amount = Math.round(amount / 0.1) * 0.1;
        delta = axis.clone().multiplyScalar(amount);
        s.mouseValue = amount;
      } else {
        delta = basis.right.clone().multiplyScalar(dx * units).addScaledVector(basis.up, -dy * units);
        if (event.ctrlKey) {
          delta.x = Math.round(delta.x / 0.1) * 0.1;
          delta.y = Math.round(delta.y / 0.1) * 0.1;
          delta.z = Math.round(delta.z / 0.1) * 0.1;
        }
        s.mouseValue = delta.length();
      }
      return { delta };
    }

    if (s.mode === 'rotate') {
      let degrees = (dx - dy) * 0.45;
      if (event.ctrlKey) degrees = Math.round(degrees / 5) * 5;
      s.mouseValue = degrees;
      return { degrees, axis: axis ?? basis.forward };
    }

    let factor = Math.exp((dx - dy) * 0.006);
    if (event.ctrlKey) factor = Math.max(0.01, Math.round(factor * 10) / 10);
    s.mouseValue = factor;
    return { factor, axis: s.axis };
  }

  applyPointerPreview(event) {
    const s = this.state;
    if (!s) return;
    s.pointerX = event.clientX;
    s.pointerY = event.clientY;
    s.buffer = '';
    this.ensureHistory();
    this.resetPreview();
    const transform = this.pointerTransform(event);
    this.applyTransform(transform);
    s.previewApplied = true;
    this.render();
  }

  applyTransform(transform) {
    const s = this.state;
    if (!s) return;
    if (s.kind === 'edit') this.applyEditTransform(transform);
    else this.applyObjectTransform(transform);
  }

  applyObjectTransform(transform) {
    const s = this.state;
    for (const start of s.starts) {
      if (s.mode === 'translate') {
        start.object.position.copy(parentLocalPosition(start.object, start.worldPosition.clone().add(transform.delta)));
      } else if (s.mode === 'rotate') {
        const delta = new THREE.Quaternion().setFromAxisAngle(transform.axis.clone().normalize(), transform.degrees * DEG2RAD);
        const targetWorld = delta.multiply(start.worldQuaternion.clone());
        start.object.quaternion.copy(parentLocalQuaternion(start.object, targetWorld));
      } else if (transform.axis) {
        start.object.scale.copy(start.scale);
        start.object.scale[transform.axis] = start.scale[transform.axis] * transform.factor;
      } else {
        start.object.scale.copy(start.scale).multiplyScalar(transform.factor);
      }
      start.object.updateMatrix();
      start.object.updateMatrixWorld(true);
    }
    this.editor.updateSelectionBoxes();
    this.editor.events.onTransform(this.editor.selected);
  }

  applyEditTransform(transform) {
    const s = this.state;
    const mesh = this.editMode.mesh;
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    const inverse = mesh.matrixWorld.clone().invert();

    for (const item of s.snapshot) {
      const vertex = this.editMode.vertices[item.id];
      if (!vertex) continue;
      if (s.mode === 'translate') {
        vertex.position.copy(item.position.clone().applyMatrix4(mesh.matrixWorld).add(transform.delta).applyMatrix4(inverse));
      } else if (s.mode === 'rotate') {
        const world = item.position.clone().applyMatrix4(mesh.matrixWorld).sub(s.centerWorld);
        world.applyAxisAngle(transform.axis.clone().normalize(), transform.degrees * DEG2RAD).add(s.centerWorld);
        vertex.position.copy(world.applyMatrix4(inverse));
      } else {
        const localCenter = s.centerWorld.clone().applyMatrix4(inverse);
        const next = item.position.clone().sub(localCenter);
        if (transform.axis) next[transform.axis] *= transform.factor;
        else next.multiplyScalar(transform.factor);
        vertex.position.copy(next.add(localCenter));
      }
    }
    syncLogicalPositions(mesh, this.editMode.vertices);
    this.editMode.refreshOverlay();
    this.editMode.updatePivot();
  }

  hasValidNumericInput() {
    if (!this.state) return false;
    return this.state.buffer !== ''
      && this.state.buffer !== '-'
      && this.state.buffer !== '.'
      && Number.isFinite(Number(this.state.buffer));
  }

  numericTransform() {
    const s = this.state;
    const value = Number(s.buffer);
    const basis = this.cameraBasis();
    const axis = this.axisVector();
    if (s.mode === 'scale') return { factor: value, axis: s.axis };
    if (s.mode === 'rotate') return { degrees: value, axis: axis ?? basis.forward };
    if (axis) return { delta: axis.multiplyScalar(value) };

    const current = this.pointerTransform({
      clientX: s.pointerX,
      clientY: s.pointerY,
      shiftKey: false,
      ctrlKey: false,
    }).delta;
    const direction = current.lengthSq() > 1e-10 ? current.normalize() : basis.right;
    return { delta: direction.multiplyScalar(value) };
  }

  applyNumericPreview() {
    if (!this.state) return;
    if (!this.hasValidNumericInput()) {
      this.resetPreview();
      this.render();
      return;
    }
    this.ensureHistory();
    this.resetPreview();
    const transform = this.numericTransform();
    this.state.mouseValue = Number(this.state.buffer);
    this.applyTransform(transform);
    this.state.previewApplied = true;
    this.render();
  }

  projectWorld(point) {
    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    const ndc = point.clone().project(this.editor.camera);
    return {
      x: rect.left + (ndc.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - ndc.y) * 0.5 * rect.height,
      visible: ndc.z >= -1.2 && ndc.z <= 1.2,
    };
  }

  ghostPairs() {
    const s = this.state;
    if (!s) return [];
    if (s.kind === 'object') {
      return s.starts.map((start) => ({
        from: start.worldPosition,
        to: start.object.getWorldPosition(new THREE.Vector3()),
      }));
    }
    const mesh = this.editMode.mesh;
    if (!mesh) return [];
    mesh.updateWorldMatrix(true, false);
    return s.snapshot.map((item) => ({
      from: item.position.clone().applyMatrix4(mesh.matrixWorld),
      to: this.editMode.vertices[item.id]?.position.clone().applyMatrix4(mesh.matrixWorld) ?? item.position.clone().applyMatrix4(mesh.matrixWorld),
    }));
  }

  valueText() {
    const s = this.state;
    if (!s) return '';
    const axis = s.axis ? ` ${s.axis.toUpperCase()}` : '';
    if (s.buffer) return `${axis} ${s.buffer}`.trim();
    if (s.mode === 'translate') return `${axis} ${(s.mouseValue ?? 0).toFixed(3)}`.trim();
    if (s.mode === 'rotate') return `${axis} ${(s.mouseValue ?? 0).toFixed(1)}°`.trim();
    return `${axis} ${(s.mouseValue ?? 1).toFixed(3)}×`.trim();
  }

  render() {
    if (!this.state) {
      this.hud.hidden = true;
      this.overlay.hide();
      return;
    }
    const s = this.state;
    let svg = '';
    svg += line(s.startX, s.startY, s.pointerX, s.pointerY, { color: '#f59b23', opacity: 0.34, dash: '4 5' });
    svg += cross(s.startX, s.startY, { color: '#66c7ff', opacity: 0.75 });

    for (const pair of this.ghostPairs().slice(0, 260)) {
      const from = this.projectWorld(pair.from);
      const to = this.projectWorld(pair.to);
      if (!from.visible || !to.visible) continue;
      svg += circle(from.x, from.y, { radius: 4, color: '#66c7ff', fill: 'rgba(102,199,255,.08)', opacity: 0.76 });
      svg += line(from.x, from.y, to.x, to.y, { color: '#f59b23', opacity: 0.36, dash: '3 4' });
      svg += circle(to.x, to.y, { radius: 4, color: '#f59b23', fill: '#f59b23', opacity: 0.92 });
    }

    if (s.axis) {
      const axis = this.axisVector();
      const length = Math.max(worldPerPixel(this.editor, s.centerWorld) * 90, 0.25);
      const a = this.projectWorld(s.centerWorld.clone().addScaledVector(axis, -length));
      const b = this.projectWorld(s.centerWorld.clone().addScaledVector(axis, length));
      if (a.visible && b.visible) svg += line(a.x, a.y, b.x, b.y, { color: AXIS_COLORS[s.axis], width: 2, opacity: 0.85 });
    }

    const en = language() === 'en';
    const hint = en
      ? 'Move mouse · X/Y/Z constrain · LMB/Enter apply · RMB/Esc cancel · Shift precision · Ctrl snap'
      : 'Двигайте мышь · X/Y/Z ограничить · ЛКМ/Enter применить · ПКМ/Esc отменить · Shift точно · Ctrl шаг';
    this.overlay.show({
      x: s.pointerX,
      y: s.pointerY,
      title: `${label(s.mode)}${s.axis ? ` · ${s.axis.toUpperCase()}` : ''}`,
      value: this.valueText(),
      hint,
      svg,
    });
    this.hud.hidden = true;
    this.status(en ? `${label(s.mode)} · interactive transform` : `${label(s.mode)} · интерактивная трансформация`);
  }

  commit({ silent = false } = {}) {
    if (!this.state) return;
    const s = this.state;
    if (!s.previewApplied) {
      this.finishWithoutRevert({ silent });
      return;
    }
    if (s.historyStarted) this.editor.commitHistory();
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    this.overlay.hide();
    this.hud.hidden = true;
    if (s.kind === 'edit') this.editMode.updatePivot();
    if (!silent) this.status(language() === 'en' ? `${label(s.mode)} applied` : `${label(s.mode)} применено`);
    this.refresh();
  }

  cancel(revert = true) {
    if (!this.state) return;
    const s = this.state;
    this.pendingPointer = null;
    if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = 0;
    if (revert && s.previewApplied) this.resetPreview();
    if (s.historyStarted) this.editor.cancelHistory();
    this.state = null;
    this.editor.orbit.enabled = s.orbitEnabled;
    this.overlay.hide();
    this.hud.hidden = true;
    if (s.kind === 'edit') this.editMode.updatePivot();
    this.status(language() === 'en' ? 'Transform cancelled' : 'Трансформация отменена');
    this.refresh();
  }

  handleKey(event) {
    if (!this.state) return false;
    const lower = event.key.toLowerCase();
    if (['x', 'y', 'z'].includes(lower)) {
      event.preventDefault();
      this.state.axis = this.state.axis === lower ? null : lower;
      if (this.hasValidNumericInput()) this.applyNumericPreview();
      else if (this.lastPointer) this.applyPointerPreview({
        clientX: this.lastPointer.x,
        clientY: this.lastPointer.y,
        shiftKey: false,
        ctrlKey: false,
      });
      else this.render();
    } else if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      this.state.buffer += event.key;
      this.applyNumericPreview();
    } else if (event.key === '.' || event.key === ',') {
      event.preventDefault();
      if (!this.state.buffer.includes('.')) this.state.buffer += '.';
      this.applyNumericPreview();
    } else if (event.key === '-' && !this.state.buffer) {
      event.preventDefault();
      this.state.buffer = '-';
      this.render();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.state.buffer = this.state.buffer.slice(0, -1);
      this.applyNumericPreview();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.flushPointerPreview();
      this.commit();
      return true;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel(true);
      return true;
    } else {
      return false;
    }
    return true;
  }
}
