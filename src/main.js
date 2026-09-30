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

let editor;
let refreshQueued = false;
let transformRefreshQueued = false;

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (!editor) return;
    renderOutliner();
    renderInspector(editor.selected);
    renderStats();
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

editor = new Editor3D(viewport, {
  onSelection: scheduleRefresh,
  onStructure: scheduleRefresh,
  onTransform: scheduleTransformRefresh,
  onStatus: setStatus,
});

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
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `outliner-row${object === editor.selected ? ' selected' : ''}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.title = object.name || object.type;

    const type = document.createElement('span');
    type.className = 'outliner-type';
    type.textContent = object.isMesh ? '◇' : object.isGroup ? '▾' : '·';

    const name = document.createElement('span');
    name.className = 'outliner-name';
    name.textContent = object.name || object.type || 'Object';

    const visibility = document.createElement('span');
    visibility.className = 'outliner-visibility';
    visibility.textContent = object.visible ? '◉' : '○';
    visibility.title = object.visible ? 'Скрыть' : 'Показать';
    visibility.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      editor.setVisible(object, !object.visible);
    });

    row.append(type, name, visibility);
    row.addEventListener('click', () => editor.select(object));
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
  sceneStats.textContent = `Objects ${stats.objects.toLocaleString()} · Vertices ${stats.vertices.toLocaleString()} · Triangles ${stats.triangles.toLocaleString()}`;
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

$$('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    closeMenus();

    if (action === 'new') editor.newScene();
    else if (action === 'import') fileInput.click();
    else if (action === 'export') exportScene();
    else if (action === 'delete') editor.deleteSelected();
  });
});

$$('[data-primitive]').forEach((button) => {
  button.addEventListener('click', () => {
    editor.addPrimitive(button.dataset.primitive);
    closeMenus();
  });
});

$$('[data-transform-mode]').forEach((button) => {
  button.addEventListener('click', () => setTransformMode(button.dataset.transformMode));
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
  input.addEventListener('input', () => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    const value = input.dataset.angle === 'true' ? raw * DEG2RAD : raw;
    editor.setTransformValue(input.dataset.transform, value);
  });
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (typing) return;

  if (event.shiftKey && event.code === 'KeyA') {
    event.preventDefault();
    $('#add-menu').setAttribute('open', '');
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return;

  switch (event.code) {
    case 'KeyG':
      setTransformMode('translate');
      break;
    case 'KeyR':
      setTransformMode('rotate');
      break;
    case 'KeyS':
      setTransformMode('scale');
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
setStatus('Готово · G Move · R Rotate · S Scale · Shift+A Add');
