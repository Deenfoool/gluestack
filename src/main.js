import { createIcons, icons } from 'lucide';
import { Editor3D } from './editor.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const DEG2RAD = Math.PI / 180;

const viewport = $('#viewport');
const outliner = $('#outliner');
const statusMessage = $('#status-message');
const sceneStats = $('#scene-stats');
const objectProperties = $('#object-properties');
const emptyProperties = $('#empty-properties');
const objectName = $('#object-name');
const fileInput = $('#file-input');
const transformHud = $('#transform-hud');

let editor;
let refreshQueued = false;
let transformRefreshQueued = false;
let modalTransform = null;

function refreshIcons() {
  createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (!editor) return;
    renderOutliner();
    renderInspector(editor.selected);
    renderStats();
    refreshIcons();
  });
}

function scheduleTransformRefresh() {
  if (transformRefreshQueued) return;
  transformRefreshQueued = true;
  requestAnimationFrame(() => {
    transformRefreshQueued = false;
    if (!editor) return;
    renderInspector(editor.selected);
    renderStats();
  });
}

function setStatus(message) {
  statusMessage.textContent = message;
}

function renderHistory(state) {
  $$('[data-history="undo"]').forEach((button) => {
    button.disabled = !state.canUndo;
    button.title = state.canUndo ? `Undo: ${state.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  });
  $$('[data-history="redo"]').forEach((button) => {
    button.disabled = !state.canRedo;
    button.title = state.canRedo ? `Redo: ${state.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  });
}

editor = new Editor3D(viewport, {
  onSelection: scheduleRefresh,
  onStructure: scheduleRefresh,
  onTransform: scheduleTransformRefresh,
  onHistory: renderHistory,
  onStatus: setStatus,
});

function icon(name, className = '') {
  const element = document.createElement('i');
  element.dataset.lucide = name;
  if (className) element.className = className;
  return element;
}

function renderOutliner() {
  outliner.replaceChildren();
  const objects = editor.getObjects();

  if (!objects.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-properties';
    empty.textContent = 'Scene Collection пуста';
    outliner.appendChild(empty);
    return;
  }

  for (const { object, depth } of objects) {
    const row = document.createElement('div');
    row.className = `outliner-row${editor.isSelected(object) ? ' selected' : ''}${object === editor.selected ? ' active' : ''}`;
    row.style.paddingLeft = `${7 + depth * 14}px`;
    row.title = object.name || object.type;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const type = document.createElement('span');
    type.className = 'outliner-type';
    type.appendChild(icon(object.userData.gluestackCollection ? 'folder' : object.isMesh ? 'box' : 'layers-3'));

    const name = document.createElement('span');
    name.className = 'outliner-name';
    name.textContent = object.name || object.type || 'Object';

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.className = 'outliner-visibility';
    visibility.title = object.visible ? 'Скрыть' : 'Показать';
    visibility.appendChild(icon(object.visible ? 'eye' : 'eye-off'));
    visibility.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      editor.setVisible(object, !object.visible);
    });

    row.append(type, name, visibility);
    row.addEventListener('click', (event) => editor.select(object, event.shiftKey));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        editor.select(object, event.shiftKey);
      }
    });
    outliner.appendChild(row);
  }
}

function renderInspector(object) {
  if (!object) {
    emptyProperties.hidden = false;
    objectProperties.hidden = true;
    return;
  }

  emptyProperties.hidden = true;
  objectProperties.hidden = false;
  if (document.activeElement !== objectName) objectName.value = object.name || object.type || 'Object';

  const rotationDegrees = editor.getRotationDegrees(object);
  for (const input of $$('[data-transform]')) {
    if (document.activeElement === input) continue;
    const [group, axis] = input.dataset.transform.split('.');
    const value = input.dataset.angle === 'true' ? rotationDegrees[axis] : object[group][axis];
    input.value = Number(value.toFixed(4));
  }
}

function renderStats() {
  const stats = editor.getStats();
  const selected = editor.getSelectedObjects().length;
  sceneStats.textContent = `Objects ${stats.objects.toLocaleString()} · Selected ${selected} · Vertices ${stats.vertices.toLocaleString()} · Triangles ${stats.triangles.toLocaleString()}`;
}

function closeMenus() {
  $$('.menu[open]').forEach((menu) => menu.removeAttribute('open'));
}

function setTransformMode(mode) {
  editor.setTransformMode(mode);
  $$('[data-transform-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.transformMode === mode);
  });
}

async function importSelectedFile() {
  const [file] = fileInput.files;
  if (!file) return;
  try {
    await editor.importFile(file);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка импорта: ${error.message || error}`);
  } finally {
    fileInput.value = '';
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

function runAction(action) {
  closeMenus();
  if (modalTransform) cancelModalTransform(true);

  switch (action) {
    case 'new': editor.newScene(); break;
    case 'import': fileInput.click(); break;
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

$$('[data-action]').forEach((button) => {
  button.addEventListener('click', () => runAction(button.dataset.action));
});

$$('[data-history]').forEach((button) => {
  button.addEventListener('click', () => runAction(button.dataset.history));
});

$$('[data-primitive]').forEach((button) => {
  button.addEventListener('click', () => {
    if (modalTransform) cancelModalTransform(true);
    editor.addPrimitive(button.dataset.primitive);
    closeMenus();
  });
});

$$('[data-transform-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    if (modalTransform) cancelModalTransform(true);
    setTransformMode(button.dataset.transformMode);
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
    $$('.workspace-tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    setStatus(`${button.textContent.trim()} workspace`);
  });
});

$('[data-view="frame"]').addEventListener('click', () => editor.frameSelected());
fileInput.addEventListener('change', importSelectedFile);

objectName.addEventListener('change', () => editor.renameSelected(objectName.value));

$$('[data-transform]').forEach((input) => {
  input.addEventListener('focus', () => editor.beginHistory('Transform'));
  input.addEventListener('input', () => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    const value = input.dataset.angle === 'true' ? raw * DEG2RAD : raw;
    editor.setTransformValue(input.dataset.transform, value);
  });
  input.addEventListener('change', () => editor.commitHistory());
  input.addEventListener('blur', () => editor.commitHistory());
});

function beginModalTransform(mode) {
  if (!editor.selected) {
    setStatus('Сначала выберите объект');
    return;
  }
  if (modalTransform) cancelModalTransform(true);

  const objects = editor.getSelectedObjects();
  modalTransform = {
    mode,
    axis: null,
    buffer: '',
    starts: objects.map((object) => ({
      object,
      position: object.position.clone(),
      rotation: object.rotation.clone(),
      scale: object.scale.clone(),
    })),
  };
  editor.beginHistory(mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale');
  setTransformMode(mode);
  updateTransformHud();
}

function updateTransformHud() {
  if (!modalTransform) {
    transformHud.hidden = true;
    return;
  }
  const labels = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };
  const axis = modalTransform.axis ? ` ${modalTransform.axis.toUpperCase()}` : '';
  const value = modalTransform.buffer || (modalTransform.mode === 'scale' ? '1' : '0');
  transformHud.textContent = `${labels[modalTransform.mode]}${axis}: ${value}`;
  transformHud.hidden = false;

  if ((modalTransform.mode === 'translate' || modalTransform.mode === 'rotate') && !modalTransform.axis) {
    setStatus(`${labels[modalTransform.mode]} · выберите X/Y/Z, затем введите значение`);
  } else {
    setStatus(`${labels[modalTransform.mode]}${axis} · Enter подтвердить · Esc отменить`);
  }
}

function resetModalPreview() {
  if (!modalTransform) return;
  for (const start of modalTransform.starts) {
    start.object.position.copy(start.position);
    start.object.rotation.copy(start.rotation);
    start.object.scale.copy(start.scale);
    start.object.updateMatrix();
  }
  editor.updateSelectionBoxes();
  editor.events.onTransform(editor.selected);
}

function applyModalPreview() {
  if (!modalTransform) return;
  resetModalPreview();
  if (!modalTransform.buffer || modalTransform.buffer === '-' || modalTransform.buffer === '.') return;
  const value = Number(modalTransform.buffer);
  if (!Number.isFinite(value)) return;

  const { mode, axis } = modalTransform;
  if ((mode === 'translate' || mode === 'rotate') && !axis) return;

  for (const start of modalTransform.starts) {
    if (mode === 'translate') {
      start.object.position[axis] = start.position[axis] + value;
    } else if (mode === 'rotate') {
      start.object.rotation[axis] = start.rotation[axis] + value * DEG2RAD;
    } else if (mode === 'scale') {
      if (axis) start.object.scale[axis] = start.scale[axis] * value;
      else start.object.scale.copy(start.scale).multiplyScalar(value);
    }
    start.object.updateMatrix();
  }
  editor.updateSelectionBoxes();
  editor.events.onTransform(editor.selected);
}

function commitModalTransform() {
  if (!modalTransform) return;
  const validNumber = modalTransform.buffer && Number.isFinite(Number(modalTransform.buffer));
  const hasAxis = modalTransform.mode === 'scale' || Boolean(modalTransform.axis);
  if (!validNumber || !hasAxis) {
    cancelModalTransform(true);
    return;
  }
  editor.commitHistory();
  const summary = transformHud.textContent;
  modalTransform = null;
  transformHud.hidden = true;
  setStatus(`${summary} применено`);
  scheduleTransformRefresh();
}

function cancelModalTransform(revert) {
  if (!modalTransform) return;
  if (revert) resetModalPreview();
  editor.cancelHistory();
  modalTransform = null;
  transformHud.hidden = true;
  setStatus('Transform отменён');
  scheduleTransformRefresh();
}

function handleModalKey(event) {
  if (!modalTransform) return false;

  const lower = event.key.toLowerCase();
  if (['x', 'y', 'z'].includes(lower)) {
    event.preventDefault();
    modalTransform.axis = lower;
    applyModalPreview();
    updateTransformHud();
    return true;
  }
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    modalTransform.buffer += event.key;
    applyModalPreview();
    updateTransformHud();
    return true;
  }
  if (event.key === '.' || event.key === ',') {
    event.preventDefault();
    if (!modalTransform.buffer.includes('.')) modalTransform.buffer += '.';
    applyModalPreview();
    updateTransformHud();
    return true;
  }
  if (event.key === '-' && !modalTransform.buffer) {
    event.preventDefault();
    modalTransform.buffer = '-';
    applyModalPreview();
    updateTransformHud();
    return true;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    modalTransform.buffer = modalTransform.buffer.slice(0, -1);
    applyModalPreview();
    updateTransformHud();
    return true;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    commitModalTransform();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelModalTransform(true);
    return true;
  }
  return false;
}

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (typing) return;

  if (handleModalKey(event)) return;

  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if (commandKey && event.code === 'KeyY') {
    event.preventDefault();
    editor.redo();
    return;
  }
  if (event.shiftKey && event.code === 'KeyD') {
    event.preventDefault();
    editor.duplicateSelected();
    return;
  }
  if (event.shiftKey && event.code === 'KeyA') {
    event.preventDefault();
    $('#add-menu').setAttribute('open', '');
    return;
  }
  if (commandKey && event.code === 'KeyJ') {
    event.preventDefault();
    editor.joinSelected();
    return;
  }
  if (commandKey && event.code === 'KeyP') {
    event.preventDefault();
    editor.parentSelected();
    return;
  }
  if (event.altKey && event.code === 'KeyP') {
    event.preventDefault();
    editor.clearParent();
    return;
  }
  if (commandKey && event.code === 'KeyA') {
    event.preventDefault();
    editor.applyTransform();
    return;
  }
  if (event.shiftKey && event.code === 'Tab') {
    event.preventDefault();
    snapButton.click();
    return;
  }
  if (commandKey || event.altKey) return;

  switch (event.code) {
    case 'KeyG':
      event.preventDefault();
      beginModalTransform('translate');
      break;
    case 'KeyR':
      event.preventDefault();
      beginModalTransform('rotate');
      break;
    case 'KeyS':
      event.preventDefault();
      beginModalTransform('scale');
      break;
    case 'KeyX':
    case 'Delete':
      event.preventDefault();
      editor.deleteSelected();
      break;
    case 'Home':
      event.preventDefault();
      editor.frameAll();
      break;
    case 'NumpadDecimal':
      event.preventDefault();
      editor.frameSelected();
      break;
    case 'Numpad1':
      event.preventDefault();
      editor.setView('front');
      break;
    case 'Numpad3':
      event.preventDefault();
      editor.setView('right');
      break;
    case 'Numpad7':
      event.preventDefault();
      editor.setView('top');
      break;
    default:
      break;
  }
});

scheduleRefresh();
refreshIcons();
setStatus('Готово · Shift+Click multi-select · G/R/S numeric transform · Ctrl+Z Undo');
