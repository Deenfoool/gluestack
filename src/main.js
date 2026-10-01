import { Editor3D } from './editor.js';
import { EditModeController } from './edit/controller.js';
import { KnifeTool } from './edit/knife-tool.js';
import { ModifierController } from './modifiers/controller.js';
import { bindModifierControls } from './modifiers/ui-bindings.js';
import { TransformModal } from './transform-modal.js';
import { bindKeyboard } from './keyboard.js';
import { bevelFace } from './edit/bevel.js';
import { dissolveSelected } from './edit/dissolve.js';
import { loopCut } from './edit/cuts.js';
import {
  refreshIcons,
  renderHistory,
  renderInspector,
  renderModeUI,
  renderOutliner,
  renderStats,
} from './ui.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const DEG2RAD = Math.PI / 180;

const elements = {
  viewport: $('#viewport'),
  outliner: $('#outliner'),
  statusMessage: $('#status-message'),
  sceneStats: $('#scene-stats'),
  objectProperties: $('#object-properties'),
  modifierProperties: $('#modifier-properties'),
  emptyProperties: $('#empty-properties'),
  objectName: $('#object-name'),
  fileInput: $('#file-input'),
  transformHud: $('#transform-hud'),
  modeToggle: $('#mode-toggle'),
  editSelectModes: $('#edit-select-modes'),
  objectMenu: $('#object-menu'),
  meshMenu: $('#mesh-menu'),
  buildLabel: $('.build-label'),
  activePropertyTab: 'object',
};

let editor;
let editMode;
let knifeTool;
let modifiers;
let refreshQueued = false;
let transformRefreshQueued = false;

function setStatus(message) { elements.statusMessage.textContent = message; }

function setPropertyTab(tab) {
  if (tab === 'modifiers' && (!editor?.selected?.isMesh || editMode?.active)) tab = 'object';
  elements.activePropertyTab = tab;
  $$('[data-property-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.propertyTab === tab);
  });
  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (!editor || !editMode) return;
    if (elements.activePropertyTab === 'modifiers' && (!editor.selected?.isMesh || editMode.active)) {
      elements.activePropertyTab = 'object';
      $$('[data-property-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.propertyTab === 'object');
      });
    }
    renderOutliner(editor, editMode, elements.outliner);
    renderInspector(editor, editMode, elements);
    renderStats(editor, editMode, elements.sceneStats);
    renderModeUI(editor, editMode, elements);
    refreshIcons();
  });
}

function scheduleTransformRefresh() {
  if (transformRefreshQueued) return;
  transformRefreshQueued = true;
  requestAnimationFrame(() => {
    transformRefreshQueued = false;
    renderInspector(editor, editMode, elements);
    renderStats(editor, editMode, elements.sceneStats);
  });
}

editor = new Editor3D(elements.viewport, {
  onSelection: scheduleRefresh,
  onStructure: scheduleRefresh,
  onTransform: scheduleTransformRefresh,
  onHistory: renderHistory,
  onStatus: setStatus,
});

editMode = new EditModeController(editor, {
  onChange: scheduleRefresh,
  onStatus: setStatus,
});
knifeTool = new KnifeTool(editor, editMode, setStatus);
modifiers = new ModifierController(editor, setStatus);
bindModifierControls(modifiers);

const objectPointerHandler = editor.handlePointerUp.bind(editor);
editor.handlePointerUp = (event) => {
  if (knifeTool.active) knifeTool.handlePointerUp(event);
  else if (editMode.active) editMode.handlePointerUp(event);
  else objectPointerHandler(event);
};

const transformModal = new TransformModal(
  editor,
  editMode,
  elements.transformHud,
  setStatus,
  scheduleTransformRefresh,
);

function closeMenus() { $$('.menu[open]').forEach((menu) => menu.removeAttribute('open')); }

function requestNumber(label, defaultValue, options = {}) {
  const raw = window.prompt(label, String(defaultValue));
  if (raw === null) return null;
  const value = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value)) {
    setStatus('Нужно ввести число');
    return null;
  }
  if (options.min !== undefined && value < options.min) return null;
  if (options.max !== undefined && value > options.max) return null;
  return value;
}

window.__gluestackEditor = editor;
window.__gluestackFeatures = {};
window.__gluestackFeatureBootstrapError = null;

async function bootstrapOptionalFeatures() {
  try {
    const { installFeatures } = await import('./features.js');
    const features = await installFeatures({ editor, editMode, knifeTool, requestNumber }) ?? {};
    window.__gluestackFeatures = features;
    window.__gluestackFeatureBootstrapError = null;
    scheduleRefresh();
    return features;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    window.__gluestackFeatureBootstrapError = failure;
    console.error('[gluestack] optional feature bundle failed to load', failure);
    setStatus(`Базовый редактор работает · Optional features error: ${failure.message}`);
    return {};
  }
}

function setTransformMode(mode) {
  editor.setTransformMode(mode);
  $$('[data-transform-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.transformMode === mode);
  });
}

async function importSelectedFile() {
  const [file] = elements.fileInput.files;
  if (!file) return;
  try {
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
    await editor.importFile(file);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка импорта: ${error.message || error}`);
  } finally {
    elements.fileInput.value = '';
  }
}

async function exportScene() {
  try {
    await editor.exportGlb('gluestack-model.glb');
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка экспорта: ${error.message || error}`);
  }
}

function runEditAction(action) {
  switch (action) {
    case 'edit-select-all': editMode.selectAll(); return true;
    case 'edit-deselect': editMode.deselectAll(); return true;
    case 'edit-delete': editMode.deleteSelection(); return true;
    case 'edit-dissolve': dissolveSelected(editMode); return true;
    case 'edit-merge': editMode.mergeSelected(); return true;
    case 'edit-fill': editMode.fillSelected(); return true;
    case 'edit-knife': knifeTool.begin(); return true;
    case 'edit-recalculate-normals': editMode.recalculateNormals(); return true;
    case 'edit-flip-normals': editMode.flipNormals(); return true;
    case 'edit-extrude': {
      const value = requestNumber('Extrude distance', 0.25);
      if (value !== null) editMode.extrude(value);
      return true;
    }
    case 'edit-inset': {
      const value = requestNumber('Inset factor (0..1)', 0.2, { min: 0.001, max: 0.999 });
      if (value !== null) editMode.inset(value);
      return true;
    }
    case 'edit-bevel': {
      const factor = requestNumber('Bevel factor (0..0.5)', 0.12, { min: 0.001, max: 0.499 });
      if (factor === null) return true;
      const depth = requestNumber('Bevel depth', 0.08);
      if (depth !== null) bevelFace(editMode, factor, depth);
      return true;
    }
    case 'edit-loop-cut': {
      const factor = requestNumber('Loop Cut factor (0..1)', 0.5, { min: 0.001, max: 0.999 });
      if (factor !== null) loopCut(editMode, factor);
      return true;
    }
    default: return false;
  }
}

function runAction(action) {
  closeMenus();
  if (transformModal.state) transformModal.cancel(true);
  if (action !== 'edit-knife') knifeTool.cancel(true);
  if (action === 'toggle-mode') {
    editMode.toggle();
    return;
  }
  if (editMode.active && runEditAction(action)) return;

  if (editMode.active && (action === 'undo' || action === 'redo')) editMode.exit();
  switch (action) {
    case 'new': if (editMode.active) editMode.exit(); editor.newScene(); break;
    case 'import': if (editMode.active) editMode.exit(); elements.fileInput.click(); break;
    case 'export': exportScene(); break;
    case 'delete': editor.deleteSelected(); break;
    case 'duplicate': editor.duplicateSelected(); break;
    case 'collection': editor.createCollection(); break;
    case 'parent': editor.parentSelected(); break;
    case 'unparent': editor.clearParent(); break;
    case 'join': editor.joinSelected(); break;
    case 'separate': editor.separateSelected(); break;
    case 'apply-transform': editor.applyTransform(); break;
    case 'origin-geometry': editor.originToGeometry(); break;
    case 'undo': editor.undo(); break;
    case 'redo': editor.redo(); break;
    default: break;
  }
}

$$('[data-action]').forEach((button) => button.addEventListener('click', () => runAction(button.dataset.action)));
$$('[data-history]').forEach((button) => button.addEventListener('click', () => runAction(button.dataset.history)));
$$('[data-primitive]').forEach((button) => {
  button.addEventListener('click', () => {
    if (transformModal.state) transformModal.cancel(true);
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
    editor.addPrimitive(button.dataset.primitive);
    closeMenus();
  });
});
$$('[data-transform-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    if (transformModal.state) transformModal.commit();
    knifeTool.cancel(true);
    setTransformMode(button.dataset.transformMode);
  });
});
$$('[data-edit-select-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    knifeTool.cancel(true);
    editMode.setSelectionMode(button.dataset.editSelectMode);
  });
});
$$('[data-property-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!button.disabled) setPropertyTab(button.dataset.propertyTab);
  });
});

const snapButton = $('[data-snap]');
snapButton.addEventListener('click', () => {
  editor.setSnapEnabled(!editor.snapEnabled);
  snapButton.classList.toggle('active', editor.snapEnabled);
  snapButton.setAttribute('aria-pressed', String(editor.snapEnabled));
});

$$('.workspace-tab:not(:disabled)').forEach((button) => {
  button.addEventListener('click', () => {
    knifeTool.cancel(true);
    $$('.workspace-tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    if (button.dataset.workspace === 'modeling' && !editMode.active && editor.selected?.isMesh) editMode.enter();
    else setStatus(`${button.textContent.trim()} workspace`);
  });
});

$('[data-view="frame"]').addEventListener('click', () => editor.frameSelected());
elements.fileInput.addEventListener('change', importSelectedFile);
elements.objectName.addEventListener('change', () => editor.renameSelected(elements.objectName.value));

$$('[data-transform]').forEach((input) => {
  input.addEventListener('focus', () => editor.beginHistory('Transform'));
  input.addEventListener('input', () => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    editor.setTransformValue(input.dataset.transform, input.dataset.angle === 'true' ? raw * DEG2RAD : raw);
  });
  input.addEventListener('change', () => editor.commitHistory());
  input.addEventListener('blur', () => editor.commitHistory());
});

bindKeyboard({
  editor,
  editMode,
  knifeTool,
  transformModal,
  snapButton,
  requestNumber,
  openAddMenu: () => $('#add-menu').setAttribute('open', ''),
});

scheduleRefresh();
refreshIcons();
setStatus('Готово · базовый редактор запущен · подключаем дополнительные модули…');
window.__gluestackFeatureBootstrapPromise = bootstrapOptionalFeatures();
