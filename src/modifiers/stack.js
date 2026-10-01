import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { refreshIcons } from '../ui.js';
import { disposeGeometryIfUnreferenced } from '../runtime/resource-ownership.js';
import { ModifierController } from './controller.js';
import { applyBevelModifier } from './bevel.js';
import { applyTriangulate } from './advanced.js';
import {
  simplifyCompatibilityIssue,
  simplifyGeometryPreservingGroups,
} from '../runtime/simplify-geometry.js';

const STACK_KEY = 'gluestackModifierStack';
const ERRORS_KEY = '__gluestackModifierErrors';
const SUPPORTED = new Set(['mirror', 'array', 'bevel', 'solidify', 'subdivision', 'decimate', 'triangulate']);

function cloneDescriptor(item) {
  return {
    id: item.id,
    type: item.type,
    enabled: item.enabled !== false,
    params: structuredClone(item.params ?? {}),
    ui: structuredClone(item.ui ?? {}),
  };
}

function descriptorLabel(item) {
  const p = item.params ?? {};
  switch (item.type) {
    case 'mirror': return `Mirror ${String(p.axis ?? 'x').toUpperCase()}`;
    case 'array': return `Array ×${Math.max(2, Number(p.count) || 2)}`;
    case 'bevel': return `Bevel ${Number(p.factor ?? 0.08).toFixed(3)}`;
    case 'solidify': return `Solidify ${Number(p.thickness ?? 0.1).toFixed(3)}`;
    case 'subdivision': return `Subdivision ×${Math.max(1, Number(p.levels) || 1)}`;
    case 'decimate': return `Decimate ${Math.round((Number(p.ratio) || 0.5) * 100)}%`;
    case 'triangulate': return 'Triangulate / Normalize';
    default: return item.type;
  }
}

function parameterMarkup(item) {
  const p = item.params ?? {};
  switch (item.type) {
    case 'mirror':
      return `<label><span>Axis</span><select data-stack-param="axis"><option value="x"${p.axis === 'x' || !p.axis ? ' selected' : ''}>X</option><option value="y"${p.axis === 'y' ? ' selected' : ''}>Y</option><option value="z"${p.axis === 'z' ? ' selected' : ''}>Z</option></select></label>`;
    case 'array':
      return `
        <label><span>Count</span><input data-stack-param="count" type="number" min="2" max="100" step="1" value="${Math.max(2, Number(p.count) || 2)}"></label>
        <label><span>Offset X</span><input data-stack-param="x" type="number" step="0.1" value="${Number(p.x) || 0}"></label>
        <label><span>Offset Y</span><input data-stack-param="y" type="number" step="0.1" value="${Number(p.y) || 0}"></label>
        <label><span>Offset Z</span><input data-stack-param="z" type="number" step="0.1" value="${Number(p.z) || 0}"></label>`;
    case 'bevel':
      return `<label><span>Factor</span><input data-stack-param="factor" type="number" min="0.001" max="0.449" step="0.01" value="${Number(p.factor) || 0.08}"></label>`;
    case 'solidify':
      return `<label><span>Thickness</span><input data-stack-param="thickness" type="number" step="0.01" value="${Number(p.thickness) || 0.1}"></label>`;
    case 'subdivision':
      return `<label><span>Levels</span><input data-stack-param="levels" type="number" min="1" max="3" step="1" value="${Math.max(1, Number(p.levels) || 1)}"></label>`;
    case 'decimate':
      return `<label><span>Ratio</span><input data-stack-param="ratio" type="number" min="0.01" max="0.99" step="0.05" value="${THREE.MathUtils.clamp(Number(p.ratio) || 0.5, 0.01, 0.99)}"></label>`;
    default:
      return '<div class="modifier-stack-no-params">No editable parameters</div>';
  }
}

function readParamValue(input) {
  if (input.tagName === 'SELECT') return input.value;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : 0;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `modifier-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isEditableMesh(mesh) {
  return Boolean(mesh?.isMesh && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && mesh.geometry?.getAttribute('position'));
}

function hasMorphData(mesh) {
  if (mesh?.morphTargetInfluences?.length) return true;
  return Object.values(mesh?.geometry?.morphAttributes ?? {}).some((items) => items?.length);
}

export function installModifierStack({ editor, editMode, modifiers }) {
  if (!editor || !modifiers || editor.modifierStack) return editor?.modifierStack ?? null;

  const sourceByMesh = new WeakMap();
  const sourceById = new Map();
  const rebuilding = new WeakSet();
  let draggedId = null;

  function stackOf(mesh) {
    if (!mesh?.isMesh) return [];
    if (!Array.isArray(mesh.userData?.[STACK_KEY])) mesh.userData[STACK_KEY] = [];
    return mesh.userData[STACK_KEY];
  }

  function errorsOf(mesh) {
    if (!mesh?.userData) return {};
    if (!mesh.userData[ERRORS_KEY] || typeof mesh.userData[ERRORS_KEY] !== 'object') mesh.userData[ERRORS_KEY] = {};
    return mesh.userData[ERRORS_KEY];
  }

  function meshId(mesh) {
    editor.assignIds(mesh);
    return mesh.userData.gluestackId;
  }

  function forgetSource(mesh, dispose = true) {
    if (!mesh?.isMesh) return;
    const id = mesh.userData?.gluestackId;
    const source = sourceByMesh.get(mesh) ?? (id ? sourceById.get(id) : null);
    sourceByMesh.delete(mesh);
    if (id) sourceById.delete(id);
    if (dispose) source?.dispose?.();
  }

  function pruneSourceCache() {
    const liveIds = new Set();
    editor.modelRoot.traverse((object) => {
      if (object.userData?.gluestackId) liveIds.add(object.userData.gluestackId);
    });
    for (const [id, source] of sourceById) {
      if (liveIds.has(id)) continue;
      sourceById.delete(id);
      source?.dispose?.();
    }
  }

  function captureSource(mesh, force = false) {
    if (!isEditableMesh(mesh)) return null;
    const stack = stackOf(mesh);
    if (!force && stack.length && sourceByMesh.has(mesh)) return sourceByMesh.get(mesh);
    const id = meshId(mesh);
    if (!force && stack.length && sourceById.has(id)) {
      const source = sourceById.get(id);
      sourceByMesh.set(mesh, source);
      return source;
    }
    const previous = sourceById.get(id);
    const source = mesh.geometry.clone();
    source.computeBoundingBox();
    source.computeBoundingSphere();
    sourceByMesh.set(mesh, source);
    sourceById.set(id, source);
    if (previous && previous !== source) previous.dispose?.();
    return source;
  }

  function sourceFor(mesh) {
    if (sourceByMesh.has(mesh)) return sourceByMesh.get(mesh);
    const id = mesh?.userData?.gluestackId;
    if (id && sourceById.has(id)) {
      const source = sourceById.get(id);
      sourceByMesh.set(mesh, source);
      return source;
    }
    return captureSource(mesh, true);
  }

  function fakeEnvironment(temp) {
    const root = new THREE.Group();
    root.add(temp);
    const fakeEditor = {
      selected: temp,
      modelRoot: root,
      checkpoint() {},
      refreshSelectionVisuals() {},
      assignIds() {},
      events: { onTransform() {}, onStructure() {}, onStatus() {} },
    };
    const controller = new ModifierController(fakeEditor, () => {});
    return { root, controller };
  }

  function evaluateDescriptor(temp, controller, item) {
    const p = item.params ?? {};
    switch (item.type) {
      case 'mirror':
        return controller.applyMirror(['x', 'y', 'z'].includes(p.axis) ? p.axis : 'x');
      case 'array':
        return controller.applyArray(
          Math.max(2, Math.min(100, Math.floor(Number(p.count) || 2))),
          new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0),
        );
      case 'bevel':
        return applyBevelModifier(controller, Number(p.factor) || 0.08);
      case 'solidify':
        return controller.applySolidify(Number(p.thickness) || 0.1);
      case 'subdivision':
        return controller.applySubdivision(Math.max(1, Math.min(3, Math.floor(Number(p.levels) || 1))));
      case 'triangulate':
        return applyTriangulate(controller);
      case 'decimate': {
        const issue = simplifyCompatibilityIssue(temp);
        if (issue) throw new Error(`Decimate: ${issue}`);
        const ratio = THREE.MathUtils.clamp(Number(p.ratio) || 0.5, 0.01, 0.99);
        const source = temp.geometry;
        const { geometry } = simplifyGeometryPreservingGroups(source, ratio);
        temp.geometry = geometry;
        source.dispose();
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        else geometry.normalizeNormals();
        return true;
      }
      default:
        return false;
    }
  }

  function evaluateItems(mesh, items, source) {
    const temp = new THREE.Mesh(source.clone(), mesh.material);
    temp.name = mesh.name;
    temp.userData = structuredClone(mesh.userData ?? {});
    const { root, controller } = fakeEnvironment(temp);
    let current = null;
    try {
      for (const item of items) {
        if (item.enabled === false) continue;
        current = item;
        if (!SUPPORTED.has(item.type)) throw new Error(`Неизвестный modifier: ${item.type}`);
        if (evaluateDescriptor(temp, controller, item) === false) throw new Error(`${descriptorLabel(item)} не удалось вычислить`);
      }
      root.remove(temp);
      const geometry = temp.geometry;
      temp.geometry = new THREE.BufferGeometry();
      temp.geometry.dispose();
      return { geometry, failedItem: null };
    } catch (error) {
      temp.geometry?.dispose?.();
      error.modifierId = current?.id ?? null;
      throw error;
    }
  }

  function rebuild(mesh, { silent = false } = {}) {
    if (!isEditableMesh(mesh) || rebuilding.has(mesh)) return false;
    const stack = stackOf(mesh);
    const source = sourceFor(mesh);
    if (!source) return false;

    rebuilding.add(mesh);
    mesh.userData[ERRORS_KEY] = {};
    try {
      const { geometry } = evaluateItems(mesh, stack, source);
      const previous = mesh.geometry;
      mesh.geometry = geometry;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      disposeGeometryIfUnreferenced(editor, previous);
      editor.refreshSelectionVisuals();
      editor.events.onTransform(mesh);
      editor.events.onStructure();
      if (!silent) editor.events.onStatus(`Modifier Stack · ${stack.length} item(s)`);
      return true;
    } catch (error) {
      if (error.modifierId) errorsOf(mesh)[error.modifierId] = error.message || String(error);
      console.error('[gluestack] modifier stack rebuild failed', error);
      if (!silent) editor.events.onStatus(`Modifier Stack: ${error.message || error}`);
      return false;
    } finally {
      rebuilding.delete(mesh);
    }
  }

  function add(type, params = {}) {
    const mesh = editor.selected;
    if (!isEditableMesh(mesh) || hasMorphData(mesh)) {
      editor.events.onStatus('Modifier Stack: выберите обычный Mesh без morph targets');
      return false;
    }
    if (!SUPPORTED.has(type)) return false;
    const stack = stackOf(mesh);
    if (!stack.length) captureSource(mesh, true);
    editor.checkpoint(`Add ${type} modifier`);
    stack.push({ id: makeId(), type, enabled: true, params: structuredClone(params), ui: { collapsed: false } });
    const ok = rebuild(mesh);
    render();
    return ok;
  }

  function updateItem(mesh, id, mutate, label = 'Edit modifier stack') {
    const stack = stackOf(mesh);
    const item = stack.find((entry) => entry.id === id);
    if (!item) return false;
    editor.checkpoint(label);
    mutate(item, stack);
    const ok = rebuild(mesh);
    render();
    return ok;
  }

  function updateParam(mesh, id, key, value) {
    return updateItem(mesh, id, (item) => {
      item.params ??= {};
      item.params[key] = value;
    }, `Edit ${key} modifier parameter`);
  }

  function toggle(mesh, id) {
    return updateItem(mesh, id, (item) => { item.enabled = item.enabled === false; }, 'Toggle modifier');
  }

  function toggleCollapsed(mesh, id) {
    const item = stackOf(mesh).find((entry) => entry.id === id);
    if (!item) return false;
    editor.checkpoint('Toggle modifier panel');
    item.ui ??= {};
    item.ui.collapsed = !item.ui.collapsed;
    editor.events.onStructure();
    render();
    return true;
  }

  function duplicate(mesh, id) {
    return updateItem(mesh, id, (item, stack) => {
      const index = stack.indexOf(item);
      const copy = cloneDescriptor(item);
      copy.id = makeId();
      copy.ui = { ...(copy.ui ?? {}), collapsed: false };
      stack.splice(index + 1, 0, copy);
    }, 'Duplicate modifier');
  }

  function remove(mesh, id) {
    return updateItem(mesh, id, (_item, stack) => {
      const index = stack.findIndex((entry) => entry.id === id);
      if (index >= 0) stack.splice(index, 1);
    }, 'Remove modifier');
  }

  function moveTo(mesh, id, targetIndex) {
    return updateItem(mesh, id, (_item, stack) => {
      const index = stack.findIndex((entry) => entry.id === id);
      const next = THREE.MathUtils.clamp(targetIndex, 0, stack.length - 1);
      if (index >= 0 && next !== index) {
        const [entry] = stack.splice(index, 1);
        stack.splice(next, 0, entry);
      }
    }, 'Reorder modifier');
  }

  function move(mesh, id, delta) {
    const index = stackOf(mesh).findIndex((entry) => entry.id === id);
    return index >= 0 ? moveTo(mesh, id, index + delta) : false;
  }

  function bakeThrough(mesh, id) {
    if (!isEditableMesh(mesh)) return false;
    const stack = stackOf(mesh);
    const index = stack.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const source = sourceFor(mesh);
    if (!source) return false;
    editor.checkpoint('Bake modifiers through selected');
    try {
      const baked = evaluateItems(mesh, stack.slice(0, index + 1), source).geometry;
      const meshIdValue = meshId(mesh);
      const previousSource = sourceById.get(meshIdValue);
      sourceByMesh.set(mesh, baked);
      sourceById.set(meshIdValue, baked);
      if (previousSource && previousSource !== baked) previousSource.dispose?.();
      stack.splice(0, index + 1);
      const ok = rebuild(mesh);
      editor.events.onStatus(ok ? 'Modifier Stack: верхняя часть запечена в source geometry' : 'Bake выполнен, но оставшийся stack содержит ошибку');
      render();
      return ok;
    } catch (error) {
      editor.events.onStatus(`Bake Through: ${error.message || error}`);
      return false;
    }
  }

  function clear(mesh = editor.selected) {
    if (!isEditableMesh(mesh) || !stackOf(mesh).length) return false;
    const source = sourceFor(mesh);
    if (!source) return false;
    editor.checkpoint('Clear modifier stack');
    const previous = mesh.geometry;
    mesh.geometry = source.clone();
    mesh.userData[STACK_KEY] = [];
    delete mesh.userData[ERRORS_KEY];
    disposeGeometryIfUnreferenced(editor, previous);
    forgetSource(mesh, true);
    editor.refreshSelectionVisuals();
    editor.events.onTransform(mesh);
    editor.events.onStructure();
    editor.events.onStatus('Modifier Stack очищен · исходная geometry восстановлена');
    render();
    return true;
  }

  function apply(mesh = editor.selected) {
    if (!isEditableMesh(mesh) || !stackOf(mesh).length) return false;
    editor.checkpoint('Apply modifier stack');
    mesh.userData[STACK_KEY] = [];
    delete mesh.userData[ERRORS_KEY];
    forgetSource(mesh, true);
    editor.refreshSelectionVisuals();
    editor.events.onTransform(mesh);
    editor.events.onStructure();
    editor.events.onStatus('Modifier Stack применён к geometry');
    render();
    return true;
  }

  function hasStack(mesh = editor.selected) {
    return Boolean(mesh?.isMesh && stackOf(mesh).length);
  }

  function createProjectExportRoot() {
    pruneSourceCache();
    const root = cloneSkeleton(editor.modelRoot);
    const originals = new Map();
    editor.modelRoot.traverse((object) => {
      const id = object.userData?.gluestackId;
      if (id) originals.set(id, object);
    });
    const ownedGeometries = [];
    root.traverse((object) => {
      if (!object.isMesh) return;
      delete object.userData?.[ERRORS_KEY];
      const id = object.userData?.gluestackId;
      const original = originals.get(id);
      if (!original || !stackOf(original).length) return;
      const source = sourceFor(original);
      if (!source) return;
      object.geometry = source.clone();
      ownedGeometries.push(object.geometry);
      object.userData[STACK_KEY] = stackOf(original).map(cloneDescriptor);
    });
    return { root, ownedGeometries };
  }

  function disposeProjectExportRoot(payload) {
    for (const geometry of payload?.ownedGeometries ?? []) geometry.dispose();
  }

  function restoreAll() {
    pruneSourceCache();
    const meshes = [];
    editor.modelRoot.traverse((object) => {
      if (object.isMesh && Array.isArray(object.userData?.[STACK_KEY]) && object.userData[STACK_KEY].length) meshes.push(object);
    });
    for (const mesh of meshes) {
      captureSource(mesh, true);
      rebuild(mesh, { silent: true });
    }
    render();
    if (meshes.length) editor.events.onStatus(`Modifier Stack восстановлен · ${meshes.length} mesh(es)`);
    return meshes.length;
  }

  const panelRoot = document.querySelector('#modifier-properties');
  let list = null;
  if (panelRoot) {
    const card = document.createElement('div');
    card.className = 'modifier-card modifier-stack-card';
    card.innerHTML = `
      <div class="modifier-title"><i data-lucide="list-tree"></i><span>Modifier Stack</span></div>
      <div class="modifier-stack-note">Неразрушающий порядок сверху вниз. Параметры можно менять после добавления; Edit/UV требуют Apply/Clear Stack.</div>
      <div class="modifier-stack-list" data-modifier-stack-list></div>
      <div class="modifier-stack-actions">
        <button type="button" data-stack-apply><i data-lucide="check-check"></i><span>Apply Stack</span></button>
        <button type="button" data-stack-clear><i data-lucide="rotate-ccw"></i><span>Clear</span></button>
      </div>`;
    panelRoot.prepend(card);
    list = card.querySelector('[data-modifier-stack-list]');
    card.querySelector('[data-stack-apply]').addEventListener('click', () => apply());
    card.querySelector('[data-stack-clear]').addEventListener('click', () => clear());

    const style = document.createElement('style');
    style.textContent = `
      .modifier-stack-note{font-size:10px;color:#929292;line-height:1.35;margin-bottom:7px}.modifier-stack-list{display:grid;gap:5px}.modifier-stack-empty{padding:7px;border:1px dashed #484848;border-radius:3px;color:#858585;text-align:center;font-size:10px}.modifier-stack-entry{background:#252525;border:1px solid #414141;border-radius:3px;overflow:hidden}.modifier-stack-entry.disabled{opacity:.55}.modifier-stack-entry.error{border-color:#a85050}.modifier-stack-head{display:grid;grid-template-columns:20px 24px minmax(0,1fr) 24px 24px 24px 24px 24px;gap:2px;align-items:center;padding:3px}.modifier-stack-drag{cursor:grab;color:#888;display:grid;place-items:center}.modifier-stack-head>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.modifier-stack-head button,.modifier-stack-actions button,.modifier-stack-body button{min-height:24px;border:1px solid #454545;border-radius:3px;background:#323232;color:#ddd;display:flex;align-items:center;justify-content:center;gap:4px}.modifier-stack-head button:hover,.modifier-stack-actions button:hover,.modifier-stack-body button:hover{background:#484848}.modifier-stack-body{padding:6px;border-top:1px solid #393939;display:grid;gap:5px}.modifier-stack-body[hidden]{display:none}.modifier-stack-fields{display:grid;grid-template-columns:1fr 1fr;gap:4px}.modifier-stack-fields label{display:grid;grid-template-columns:minmax(52px,.8fr) minmax(0,1fr);align-items:center;gap:4px;font-size:10px;color:#aaa}.modifier-stack-fields input,.modifier-stack-fields select{min-width:0;height:23px;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.modifier-stack-no-params{font-size:10px;color:#888}.modifier-stack-error{font-size:10px;color:#e07b7b;padding:4px;background:rgba(180,60,60,.1);border-radius:3px}.modifier-stack-body-actions{display:flex;justify-content:flex-end}.modifier-stack-body-actions button{font-size:10px;padding:0 7px}.modifier-stack-actions{display:grid;grid-template-columns:1fr .65fr;gap:4px;margin-top:6px}.modifier-stack-actions button{font-size:10px}`;
    document.head.appendChild(style);
  }

  function render() {
    if (!list) return;
    pruneSourceCache();
    const mesh = editor.selected;
    list.replaceChildren();
    if (!mesh?.isMesh) {
      const empty = document.createElement('div');
      empty.className = 'modifier-stack-empty';
      empty.textContent = 'Select Mesh';
      list.appendChild(empty);
      refreshIcons();
      return;
    }
    const stack = stackOf(mesh);
    if (!stack.length) {
      const empty = document.createElement('div');
      empty.className = 'modifier-stack-empty';
      empty.textContent = 'Stack is empty';
      list.appendChild(empty);
      refreshIcons();
      return;
    }
    const errors = errorsOf(mesh);
    stack.forEach((item, index) => {
      item.ui ??= { collapsed: false };
      const entry = document.createElement('div');
      const error = errors[item.id] ?? '';
      entry.className = `modifier-stack-entry${item.enabled === false ? ' disabled' : ''}${error ? ' error' : ''}`;
      entry.dataset.modifierId = item.id;
      entry.innerHTML = `
        <div class="modifier-stack-head">
          <span class="modifier-stack-drag" draggable="true" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
          <button type="button" data-stack-collapse title="Collapse/Expand"><i data-lucide="${item.ui.collapsed ? 'chevron-right' : 'chevron-down'}"></i></button>
          <span title="${descriptorLabel(item)}">${descriptorLabel(item)}</span>
          <button type="button" data-stack-toggle title="Enable/Disable"><i data-lucide="${item.enabled === false ? 'eye-off' : 'eye'}"></i></button>
          <button type="button" data-stack-duplicate title="Duplicate"><i data-lucide="copy"></i></button>
          <button type="button" data-stack-up title="Move up"><i data-lucide="chevron-up"></i></button>
          <button type="button" data-stack-down title="Move down"><i data-lucide="chevron-down"></i></button>
          <button type="button" data-stack-remove title="Remove"><i data-lucide="x"></i></button>
        </div>
        <div class="modifier-stack-body"${item.ui.collapsed ? ' hidden' : ''}>
          <div class="modifier-stack-fields">${parameterMarkup(item)}</div>
          ${error ? `<div class="modifier-stack-error">${error}</div>` : ''}
          <div class="modifier-stack-body-actions"><button type="button" data-stack-bake><i data-lucide="layers"></i><span>Bake Through Here</span></button></div>
        </div>`;

      entry.querySelector('[data-stack-collapse]').addEventListener('click', () => toggleCollapsed(mesh, item.id));
      entry.querySelector('[data-stack-toggle]').addEventListener('click', () => toggle(mesh, item.id));
      entry.querySelector('[data-stack-duplicate]').addEventListener('click', () => duplicate(mesh, item.id));
      entry.querySelector('[data-stack-up]').addEventListener('click', () => move(mesh, item.id, -1));
      entry.querySelector('[data-stack-down]').addEventListener('click', () => move(mesh, item.id, 1));
      entry.querySelector('[data-stack-remove]').addEventListener('click', () => remove(mesh, item.id));
      entry.querySelector('[data-stack-bake]').addEventListener('click', () => bakeThrough(mesh, item.id));
      entry.querySelectorAll('[data-stack-param]').forEach((input) => {
        input.addEventListener('change', () => updateParam(mesh, item.id, input.dataset.stackParam, readParamValue(input)));
      });

      const dragHandle = entry.querySelector('.modifier-stack-drag');
      dragHandle.addEventListener('dragstart', (event) => {
        draggedId = item.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      });
      entry.addEventListener('dragover', (event) => {
        if (!draggedId || draggedId === item.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      entry.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceId = draggedId || event.dataTransfer.getData('text/plain');
        draggedId = null;
        if (sourceId && sourceId !== item.id) moveTo(mesh, sourceId, index);
      });
      dragHandle.addEventListener('dragend', () => { draggedId = null; });
      list.appendChild(entry);
    });
    refreshIcons();
  }

  const previousSelection = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelection(...args);
    render();
  };

  if (editMode?.enter) {
    const originalEnter = editMode.enter.bind(editMode);
    editMode.enter = (mesh = editor.selected) => {
      if (hasStack(mesh)) {
        editor.events.onStatus('Edit Mode: сначала Apply Stack или Clear Stack');
        return false;
      }
      return originalEnter(mesh);
    };
  }

  const api = {
    add,
    apply,
    bakeThrough,
    clear,
    duplicate,
    hasStack,
    moveTo,
    rebuild,
    render,
    restoreAll,
    stackOf,
    updateParam,
    createProjectExportRoot,
    disposeProjectExportRoot,
  };
  modifiers.stack = api;
  editor.modifierStack = api;
  render();
  return api;
}
