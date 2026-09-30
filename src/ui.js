import { createIcons, icons } from 'lucide';

export function refreshIcons() {
  createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
}

function icon(name) {
  const element = document.createElement('i');
  element.dataset.lucide = name;
  return element;
}

export function renderOutliner(editor, editMode, outliner) {
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
    if (editMode.active && object === editMode.mesh) row.classList.add('editing');
    row.style.paddingLeft = `${7 + depth * 14}px`;
    row.title = object.name || object.type;
    row.tabIndex = editMode.active ? -1 : 0;
    row.setAttribute('role', 'button');

    const type = document.createElement('span');
    type.className = 'outliner-type';
    type.appendChild(icon(object.userData.gluestackCollection ? 'folder' : object.isMesh ? 'box' : 'layers-3'));

    const name = document.createElement('span');
    name.className = 'outliner-name';
    name.append(document.createTextNode(object.name || object.type || 'Object'));
    if (editMode.active && object === editMode.mesh) {
      const badge = document.createElement('span');
      badge.className = 'edit-badge';
      badge.textContent = 'EDIT';
      name.appendChild(badge);
    }

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.className = 'outliner-visibility';
    visibility.title = object.visible ? 'Скрыть' : 'Показать';
    visibility.disabled = editMode.active;
    visibility.appendChild(icon(object.visible ? 'eye' : 'eye-off'));
    visibility.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      editor.setVisible(object, !object.visible);
    });

    row.append(type, name, visibility);
    row.addEventListener('click', (event) => {
      if (!editMode.active) editor.select(object, event.shiftKey);
    });
    row.addEventListener('keydown', (event) => {
      if (!editMode.active && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        editor.select(object, event.shiftKey);
      }
    });
    outliner.appendChild(row);
  }
}

export function renderInspector(editor, editMode, elements) {
  const {
    emptyProperties,
    objectProperties,
    modifierProperties,
    objectName,
    activePropertyTab = 'object',
  } = elements;
  const object = editor.selected;
  if (!object) {
    emptyProperties.hidden = false;
    emptyProperties.textContent = 'Выберите объект';
    objectProperties.hidden = true;
    if (modifierProperties) modifierProperties.hidden = true;
    return;
  }

  if (editMode.active) {
    emptyProperties.hidden = false;
    emptyProperties.textContent = 'Edit Mode: трансформируйте выбранные компоненты во viewport. Object Transform и Modifiers заблокированы до выхода по Tab.';
    objectProperties.hidden = true;
    if (modifierProperties) modifierProperties.hidden = true;
    return;
  }

  emptyProperties.hidden = true;
  objectProperties.hidden = activePropertyTab !== 'object';
  if (modifierProperties) modifierProperties.hidden = activePropertyTab !== 'modifiers';
  if (activePropertyTab !== 'object') return;

  if (document.activeElement !== objectName) objectName.value = object.name || object.type || 'Object';
  const rotationDegrees = editor.getRotationDegrees(object);
  document.querySelectorAll('[data-transform]').forEach((input) => {
    if (document.activeElement === input) return;
    const [group, axis] = input.dataset.transform.split('.');
    const value = input.dataset.angle === 'true' ? rotationDegrees[axis] : object[group][axis];
    input.value = Number(value.toFixed(4));
  });
}

export function renderStats(editor, editMode, sceneStats) {
  const stats = editor.getStats();
  if (editMode.active) {
    const mode = editMode.selectionMode[0].toUpperCase() + editMode.selectionMode.slice(1);
    sceneStats.textContent = `${mode} ${editMode.selectedCount()} selected · V ${editMode.vertices.length.toLocaleString()} · E ${editMode.edges.length.toLocaleString()} · F ${editMode.faceGroups.length.toLocaleString()} · Triangles ${stats.triangles.toLocaleString()}`;
    return;
  }
  const selected = editor.getSelectedObjects().length;
  sceneStats.textContent = `Objects ${stats.objects.toLocaleString()} · Selected ${selected} · Vertices ${stats.vertices.toLocaleString()} · Triangles ${stats.triangles.toLocaleString()}`;
}

export function renderModeUI(editor, editMode, elements) {
  const { modeToggle, editSelectModes, objectMenu, meshMenu, buildLabel } = elements;
  modeToggle.textContent = editMode.active ? 'Edit Mode' : 'Object Mode';
  modeToggle.classList.toggle('active', editMode.active);
  modeToggle.disabled = !editMode.active && !editor.selected?.isMesh;
  editSelectModes.hidden = !editMode.active;
  objectMenu.hidden = editMode.active;
  meshMenu.hidden = !editMode.active;
  buildLabel.textContent = editMode.active ? 'Edit Mode · v0.5' : 'Object Mode · v0.5';

  document.querySelectorAll('[data-edit-select-mode]').forEach((button) => {
    button.classList.toggle('active', editMode.active && button.dataset.editSelectMode === editMode.selectionMode);
  });
  document.querySelectorAll('.object-only').forEach((element) => { element.hidden = editMode.active; });
  document.querySelectorAll('.edit-only').forEach((element) => { element.hidden = !editMode.active; });
  const modifierTab = document.querySelector('[data-property-tab="modifiers"]');
  if (modifierTab) modifierTab.disabled = editMode.active || !editor.selected?.isMesh;
}

export function renderHistory(state) {
  document.querySelectorAll('[data-history="undo"]').forEach((button) => {
    button.disabled = !state.canUndo;
    button.title = state.canUndo ? `Undo: ${state.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  });
  document.querySelectorAll('[data-history="redo"]').forEach((button) => {
    button.disabled = !state.canRedo;
    button.title = state.canRedo ? `Redo: ${state.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  });
}
