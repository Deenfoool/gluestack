import { dissolveSelected } from './edit/dissolve.js';
import { EditModalTools } from './edit/modal-tools.js';
import { UVModalTransform } from './uv/modal-transform.js';
import { installSelectionTools } from './runtime/selection-tools.js';
import { installBoxSelect } from './runtime/box-select.js';
import { installCircleSelect } from './runtime/circle-select.js';
import { installAdvancedEditSelection } from './runtime/edit-selection-advanced.js';
import { installVertexPicking } from './runtime/vertex-picking.js';

export function bindKeyboard({ editor, editMode, knifeTool, transformModal, snapButton, openAddMenu }) {
  const selectionTools = installSelectionTools({ editor, editMode });
  const boxSelect = installBoxSelect({ editor, editMode });
  const circleSelect = installCircleSelect({ editor, editMode });
  const advancedSelection = installAdvancedEditSelection({ editMode });
  const vertexPicking = installVertexPicking({ editor, editMode, knifeTool, boxSelect, circleSelect });
  const hud = document.querySelector('#transform-hud');
  const modalTools = new EditModalTools({
    editor,
    editMode,
    knifeTool,
    transformModal,
    hud,
    status: (message) => editor.events.onStatus(message),
  });
  const uvModal = new UVModalTransform({
    getController: () => window.__gluestackFeatures?.uv?.controller ?? null,
    hud,
    status: (message) => editor.events.onStatus(message),
  });

  const actionToModal = {
    'edit-extrude': 'extrude',
    'edit-inset': 'inset',
    'edit-bevel': 'bevel',
    'edit-loop-cut': 'loopCut',
  };

  document.addEventListener('click', (event) => {
    const actionButton = event.target.closest?.('[data-action]');
    const type = actionToModal[actionButton?.dataset.action];
    if (type && editMode.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelectorAll('.menu[open]').forEach((menu) => menu.removeAttribute('open'));
      modalTools.begin(type);
      return;
    }

    const uvButton = event.target.closest?.('[data-uv-action]');
    const uvType = uvButton?.dataset.uvAction;
    if (!['move', 'rotate', 'scale'].includes(uvType)) return;
    if (document.querySelector('.workspace-tab.active')?.dataset.workspace !== 'uv') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    uvModal.begin(uvType);
  }, { capture: true });

  window.__gluestackEditModalTools = modalTools;
  window.__gluestackUVModalTransform = uvModal;
  window.__gluestackVertexPicking = vertexPicking;

  window.addEventListener('keydown', (event) => {
    if (window.__gluestackHome?.visible) return;

    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (typing) return;

    if (modalTools.active || uvModal.active) return;

    if (boxSelect?.active) {
      if (event.code === 'Escape') {
        event.preventDefault();
        boxSelect.cancel();
      }
      return;
    }

    if (circleSelect?.active) {
      if (event.code === 'Escape' || event.code === 'Enter') {
        event.preventDefault();
        circleSelect.finish();
      }
      return;
    }

    if (transformModal.handleKey(event)) return;

    if (knifeTool.active) {
      if (event.code === 'Escape' || event.code === 'KeyK') {
        event.preventDefault();
        knifeTool.cancel();
        return;
      }
      event.preventDefault();
      return;
    }

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

    const workspace = document.querySelector('.workspace-tab.active')?.dataset.workspace ?? 'layout';
    if (workspace === 'uv' || workspace === 'paint') return;

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
      if (commandKey && event.code === 'KeyI') { event.preventDefault(); selectionTools.editInvert(); return; }
      if (!commandKey && !event.altKey && event.code === 'KeyL') { event.preventDefault(); selectionTools.editLinked(); return; }
      if (commandKey && event.altKey && event.code === 'KeyR') { event.preventDefault(); advancedSelection.selectEdgeRing(); return; }
      if (event.shiftKey && !commandKey && !event.altKey && event.code === 'KeyM') { event.preventDefault(); advancedSelection.selectByMaterial(); return; }
      if (!commandKey && !event.altKey && event.code === 'KeyB') { event.preventDefault(); boxSelect?.begin(); return; }
      if (!commandKey && !event.altKey && event.code === 'KeyC') { event.preventDefault(); circleSelect?.begin(); return; }
      if (commandKey && event.code === 'KeyB') { event.preventDefault(); modalTools.begin('bevel'); return; }
      if (commandKey && event.code === 'KeyX') { event.preventDefault(); dissolveSelected(editMode); return; }
      if (commandKey && event.code === 'KeyR') { event.preventDefault(); modalTools.begin('loopCut'); return; }
      if (event.code === 'KeyE') { event.preventDefault(); modalTools.begin('extrude'); return; }
      if (!commandKey && !event.altKey && event.code === 'KeyI') { event.preventDefault(); modalTools.begin('inset'); return; }
      if (event.code === 'KeyM') { event.preventDefault(); editMode.mergeSelected(); return; }
      if (event.code === 'KeyF') { event.preventDefault(); editMode.fillSelected(); return; }
      if (event.code === 'KeyK') { event.preventDefault(); knifeTool.begin(); return; }
      if (event.shiftKey && event.code === 'KeyN') { event.preventDefault(); editMode.recalculateNormals(); return; }
      if (event.code === 'KeyX' || event.code === 'Delete') { event.preventDefault(); editMode.deleteSelection(); return; }
      if (commandKey || event.altKey) return;
      if (event.code === 'KeyG') { event.preventDefault(); transformModal.begin('translate'); return; }
      if (event.code === 'KeyR') { event.preventDefault(); transformModal.begin('rotate'); return; }
      if (event.code === 'KeyS') { event.preventDefault(); transformModal.begin('scale'); return; }
      return;
    }

    if (event.code === 'KeyA' && event.altKey) { event.preventDefault(); selectionTools.objectSelectNone(); return; }
    if (event.code === 'KeyA' && !commandKey && !event.shiftKey) { event.preventDefault(); selectionTools.objectSelectAll(); return; }
    if (commandKey && event.code === 'KeyI') { event.preventDefault(); selectionTools.objectInvert(); return; }
    if (!commandKey && !event.altKey && !event.shiftKey && event.code === 'KeyB') { event.preventDefault(); boxSelect?.begin(); return; }
    if (!commandKey && !event.altKey && !event.shiftKey && event.code === 'KeyC') { event.preventDefault(); circleSelect?.begin(); return; }
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
