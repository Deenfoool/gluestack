import { bevelFace } from './edit/bevel.js';
import { dissolveSelected } from './edit/dissolve.js';
import { knifeCenter, loopCut } from './edit/cuts.js';

export function bindKeyboard({ editor, editMode, transformModal, snapButton, openAddMenu, requestNumber }) {
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (typing) return;
    if (transformModal.handleKey(event)) return;

    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && event.code === 'KeyZ') {
      event.preventDefault();
      if (editMode.active) editMode.exit();
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (commandKey && event.code === 'KeyY') {
      event.preventDefault();
      if (editMode.active) editMode.exit();
      editor.redo();
      return;
    }
    if (event.shiftKey && event.code === 'Tab') {
      event.preventDefault();
      snapButton.click();
      return;
    }
    if (event.code === 'Tab') {
      event.preventDefault();
      editMode.toggle();
      return;
    }

    if (editMode.active) {
      if (event.code === 'Digit1') { event.preventDefault(); editMode.setSelectionMode('vertex'); return; }
      if (event.code === 'Digit2') { event.preventDefault(); editMode.setSelectionMode('edge'); return; }
      if (event.code === 'Digit3') { event.preventDefault(); editMode.setSelectionMode('face'); return; }
      if (event.code === 'KeyA' && event.altKey) { event.preventDefault(); editMode.deselectAll(); return; }
      if (event.code === 'KeyA' && !commandKey) { event.preventDefault(); editMode.selectAll(); return; }
      if (commandKey && event.code === 'KeyB') {
        event.preventDefault();
        const factor = requestNumber('Bevel factor (0..0.5)', 0.12, { min: 0.001, max: 0.499 });
        if (factor === null) return;
        const depth = requestNumber('Bevel depth', 0.08);
        if (depth !== null) bevelFace(editMode, factor, depth);
        return;
      }
      if (commandKey && event.code === 'KeyX') { event.preventDefault(); dissolveSelected(editMode); return; }
      if (commandKey && event.code === 'KeyR') {
        event.preventDefault();
        const factor = requestNumber('Loop Cut factor (0..1)', 0.5, { min: 0.001, max: 0.999 });
        if (factor !== null) loopCut(editMode, factor);
        return;
      }
      if (event.code === 'KeyE') {
        event.preventDefault();
        const value = requestNumber('Extrude distance', 0.25);
        if (value !== null) editMode.extrude(value);
        return;
      }
      if (event.code === 'KeyI') {
        event.preventDefault();
        const value = requestNumber('Inset factor (0..1)', 0.2, { min: 0.001, max: 0.999 });
        if (value !== null) editMode.inset(value);
        return;
      }
      if (event.code === 'KeyM') { event.preventDefault(); editMode.mergeSelected(); return; }
      if (event.code === 'KeyF') { event.preventDefault(); editMode.fillSelected(); return; }
      if (event.code === 'KeyK') { event.preventDefault(); knifeCenter(editMode); return; }
      if (event.shiftKey && event.code === 'KeyN') { event.preventDefault(); editMode.recalculateNormals(); return; }
      if (event.code === 'KeyX' || event.code === 'Delete') { event.preventDefault(); editMode.deleteSelection(); return; }
      if (commandKey || event.altKey) return;
      if (event.code === 'KeyG') { event.preventDefault(); transformModal.begin('translate'); return; }
      if (event.code === 'KeyR') { event.preventDefault(); transformModal.begin('rotate'); return; }
      if (event.code === 'KeyS') { event.preventDefault(); transformModal.begin('scale'); return; }
      return;
    }

    if (event.shiftKey && event.code === 'KeyD') { event.preventDefault(); editor.duplicateSelected(); return; }
    if (event.shiftKey && event.code === 'KeyA') { event.preventDefault(); openAddMenu(); return; }
    if (commandKey && event.code === 'KeyJ') { event.preventDefault(); editor.joinSelected(); return; }
    if (commandKey && event.code === 'KeyP') { event.preventDefault(); editor.parentSelected(); return; }
    if (event.altKey && event.code === 'KeyP') { event.preventDefault(); editor.clearParent(); return; }
    if (commandKey && event.code === 'KeyA') { event.preventDefault(); editor.applyTransform(); return; }
    if (commandKey || event.altKey) return;

    switch (event.code) {
      case 'KeyG': event.preventDefault(); transformModal.begin('translate'); break;
      case 'KeyR': event.preventDefault(); transformModal.begin('rotate'); break;
      case 'KeyS': event.preventDefault(); transformModal.begin('scale'); break;
      case 'KeyX':
      case 'Delete': event.preventDefault(); editor.deleteSelected(); break;
      case 'Home': event.preventDefault(); editor.frameAll(); break;
      case 'NumpadDecimal': event.preventDefault(); editor.frameSelected(); break;
      case 'Numpad1': event.preventDefault(); editor.setView('front'); break;
      case 'Numpad3': event.preventDefault(); editor.setView('right'); break;
      case 'Numpad7': event.preventDefault(); editor.setView('top'); break;
      default: break;
    }
  });
}
