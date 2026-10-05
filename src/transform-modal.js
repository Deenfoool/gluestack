const DEG2RAD = Math.PI / 180;

export class TransformModal {
  constructor(editor, editMode, hud, status, refresh) {
    this.editor = editor;
    this.editMode = editMode;
    this.hud = hud;
    this.status = status;
    this.refresh = refresh;
    this.state = null;
  }

  historyLabel() {
    if (!this.state) return 'Transform';
    const { kind, mode } = this.state;
    if (kind === 'edit') {
      return mode === 'translate' ? 'Move components' : mode === 'rotate' ? 'Rotate components' : 'Scale components';
    }
    return mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale';
  }

  hasValidPreviewInput() {
    if (!this.state) return false;
    const validNumber = this.state.buffer !== ''
      && this.state.buffer !== '-'
      && this.state.buffer !== '.'
      && Number.isFinite(Number(this.state.buffer));
    if (!validNumber) return false;
    return this.state.mode === 'scale' || Boolean(this.state.axis);
  }

  rebaseObjectSnapshot() {
    if (!this.state || this.state.kind !== 'object') return;
    this.state.starts = this.editor.getSelectedObjects().map((object) => ({
      object,
      position: object.position.clone(),
      rotation: object.rotation.clone(),
      scale: object.scale.clone(),
    }));
  }

  ensureHistory() {
    if (!this.state || this.state.historyStarted) return;

    // G/R/S also act as tool switches. The user may press S, drag the real gizmo,
    // and only then type a number. In that case the numeric transform must start
    // from the CURRENT object transform, not from the stale snapshot taken when S
    // was first pressed.
    if (this.state.kind === 'object') this.rebaseObjectSnapshot();
    else this.state.snapshot = this.editMode.captureSelectedPositions();

    this.editor.beginHistory(this.historyLabel());
    this.state.historyStarted = true;
  }

  finishWithoutRevert({ silent = false } = {}) {
    if (!this.state) return;
    if (this.state.historyStarted) this.editor.cancelHistory();
    const wasEdit = this.state.kind === 'edit';
    this.state = null;
    this.hud.hidden = true;
    if (wasEdit) this.editMode.updatePivot();
    if (!silent) this.status('Transform завершён');
    this.refresh();
  }

  finishForModeSwitch() {
    if (!this.state) return;
    if (this.hasValidPreviewInput() && this.state.previewApplied) {
      this.commit({ silent: true });
      return;
    }

    // No numeric preview means there is nothing owned by TransformModal to undo.
    // Most importantly, do NOT restore the snapshot here: the real TransformControls
    // gizmo may have changed the object while this modal was open.
    this.finishWithoutRevert({ silent: true });
  }

  begin(mode) {
    if (this.state) this.finishForModeSwitch();

    if (this.editMode.active) {
      const snapshot = this.editMode.captureSelectedPositions();
      if (!snapshot.length) {
        this.status('Edit Mode: сначала выберите компоненты');
        return false;
      }
      this.state = {
        kind: 'edit',
        mode,
        axis: null,
        buffer: '',
        snapshot,
        historyStarted: false,
        previewApplied: false,
      };
      this.editor.transform.detach();
    } else {
      if (!this.editor.selected) {
        this.status('Сначала выберите объект');
        return false;
      }
      this.state = {
        kind: 'object',
        mode,
        axis: null,
        buffer: '',
        starts: this.editor.getSelectedObjects().map((object) => ({
          object,
          position: object.position.clone(),
          rotation: object.rotation.clone(),
          scale: object.scale.clone(),
        })),
        historyStarted: false,
        previewApplied: false,
      };
    }

    // Merely switching G/R/S must never create history or own a transform snapshot.
    // History begins lazily on the first valid numeric preview.
    this.editor.setTransformMode(mode);
    this.render();
    return true;
  }

  render() {
    if (!this.state) {
      this.hud.hidden = true;
      return;
    }
    const labels = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };
    const axis = this.state.axis ? ` ${this.state.axis.toUpperCase()}` : '';
    const value = this.state.buffer || (this.state.mode === 'scale' ? '1' : '0');
    this.hud.textContent = `${labels[this.state.mode]}${axis}: ${value}`;
    this.hud.hidden = false;
    if ((this.state.mode === 'translate' || this.state.mode === 'rotate') && !this.state.axis) {
      this.status(`${labels[this.state.mode]} · выберите X/Y/Z, затем введите значение`);
    } else {
      this.status(`${labels[this.state.mode]}${axis} · Enter подтвердить · Esc отменить`);
    }
  }

  resetPreview() {
    if (!this.state || !this.state.previewApplied) return;
    if (this.state.kind === 'edit') {
      this.editMode.restoreSelectedPositions(this.state.snapshot);
      this.state.previewApplied = false;
      return;
    }
    for (const start of this.state.starts) {
      start.object.position.copy(start.position);
      start.object.rotation.copy(start.rotation);
      start.object.scale.copy(start.scale);
      start.object.updateMatrix();
    }
    this.state.previewApplied = false;
    this.editor.updateSelectionBoxes();
    this.editor.events.onTransform(this.editor.selected);
  }

  applyPreview() {
    if (!this.state) return;
    if (!this.hasValidPreviewInput()) {
      this.resetPreview();
      return;
    }

    this.ensureHistory();
    const value = Number(this.state.buffer);
    const { mode, axis } = this.state;

    if (this.state.kind === 'edit') {
      this.editMode.applyNumericTransform(this.state.snapshot, mode, axis, value);
      this.state.previewApplied = true;
      return;
    }

    if (this.state.previewApplied) this.resetPreview();
    for (const start of this.state.starts) {
      if (mode === 'translate') start.object.position[axis] = start.position[axis] + value;
      else if (mode === 'rotate') start.object.rotation[axis] = start.rotation[axis] + value * DEG2RAD;
      else if (axis) start.object.scale[axis] = start.scale[axis] * value;
      else start.object.scale.copy(start.scale).multiplyScalar(value);
      start.object.updateMatrix();
    }
    this.state.previewApplied = true;
    this.editor.updateSelectionBoxes();
    this.editor.events.onTransform(this.editor.selected);
  }

  commit({ silent = false } = {}) {
    if (!this.state) return;
    if (!this.hasValidPreviewInput() || !this.state.previewApplied) {
      this.finishWithoutRevert({ silent });
      return;
    }

    if (this.state.historyStarted) this.editor.commitHistory();
    const summary = this.hud.textContent;
    const wasEdit = this.state.kind === 'edit';
    this.state = null;
    this.hud.hidden = true;
    if (wasEdit) this.editMode.updatePivot();
    if (!silent) this.status(`${summary} применено`);
    this.refresh();
  }

  cancel(revert = true) {
    if (!this.state) return;
    if (revert && this.state.previewApplied) this.resetPreview();
    if (this.state.historyStarted) this.editor.cancelHistory();
    const wasEdit = this.state.kind === 'edit';
    this.state = null;
    this.hud.hidden = true;
    if (wasEdit) this.editMode.updatePivot();
    this.status('Transform отменён');
    this.refresh();
  }

  handleKey(event) {
    if (!this.state) return false;
    const lower = event.key.toLowerCase();
    if (['x', 'y', 'z'].includes(lower)) {
      event.preventDefault();
      this.state.axis = lower;
    } else if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      this.state.buffer += event.key;
    } else if (event.key === '.' || event.key === ',') {
      event.preventDefault();
      if (!this.state.buffer.includes('.')) this.state.buffer += '.';
    } else if (event.key === '-' && !this.state.buffer) {
      event.preventDefault();
      this.state.buffer = '-';
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.state.buffer = this.state.buffer.slice(0, -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
      return true;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel(true);
      return true;
    } else {
      return false;
    }
    this.applyPreview();
    this.render();
    return true;
  }
}
