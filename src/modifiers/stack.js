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
const SUPPORTED = new Set(['mirror', 'array', 'bevel', 'solidify', 'subdivision', 'decimate', 'triangulate']);

function cloneDescriptor(item) {
  return {
    id: item.id,
    type: item.type,
    enabled: item.enabled !== false,
    params: structuredClone(item.params ?? {}),
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

  function stackOf(mesh) {
    if (!mesh?.isMesh) return [];
    if (!Array.isArray(mesh.userData?.[STACK_KEY])) mesh.userData[STACK_KEY] = [];
    return mesh.userData[STACK_KEY];
  }

  function meshId(mesh) {
    editor.assignIds(mesh);
    return mesh.userData.gluestackId;
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
    const source = mesh.geometry.clone();
    source.computeBoundingBox();
    source.computeBoundingSphere();
    sourceByMesh.set(mesh, source);
    sourceById.set(id, source);
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

  function rebuild(mesh, { silent = false } = {}) {
    if (!isEditableMesh(mesh) || rebuilding.has(mesh)) return false;
    const stack = stackOf(mesh);
    const source = sourceFor(mesh);
    if (!source) return false;

    rebuilding.add(mesh);
    let temp = null;
    try {
      temp = new THREE.Mesh(source.clone(), mesh.material);
      temp.name = mesh.name;
      temp.userData = structuredClone(mesh.userData ?? {});
      const { root, controller } = fakeEnvironment(temp);
      for (const item of stack) {
        if (item.enabled === false) continue;
        if (!SUPPORTED.has(item.type)) throw new Error(`Неизвестный modifier: ${item.type}`);
        evaluateDescriptor(temp, controller, item);
      }
      root.remove(temp);
      const result = temp.geometry;
      temp.geometry = new THREE.BufferGeometry();
      temp.geometry.dispose();

      const previous = mesh.geometry;
      mesh.geometry = result;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      disposeGeometryIfUnreferenced(editor, previous);
      editor.refreshSelectionVisuals();
      editor.events.onTransform(mesh);
      editor.events.onStructure();
      if (!silent) editor.events.onStatus(`Modifier Stack · ${stack.length} item(s)`);
      return true;
    } catch (error) {
      console.error('[gluestack] modifier stack rebuild failed', error);
      if (!silent) editor.events.onStatus(`Modifier Stack: ${error.message || error}`);
      return false;
    } finally {
      rebuilding.delete(mesh);
      if (temp?.geometry?.dispose && temp.geometry !== mesh.geometry) temp.geometry.dispose();
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
    stack.push({ id: makeId(), type, enabled: true, params: structuredClone(params) });
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

  function toggle(mesh, id) {
    return updateItem(mesh, id, (item) => { item.enabled = item.enabled === false; }, 'Toggle modifier');
  }

  function remove(mesh, id) {
    return updateItem(mesh, id, (_item, stack) => {
      const index = stack.findIndex((entry) => entry.id === id);
      if (index >= 0) stack.splice(index, 1);
    }, 'Remove modifier');
  }

  function move(mesh, id, delta) {
    return updateItem(mesh, id, (_item, stack) => {
      const index = stack.findIndex((entry) => entry.id === id);
      const next = THREE.MathUtils.clamp(index + delta, 0, stack.length - 1);
      if (index >= 0 && next !== index) {
        const [entry] = stack.splice(index, 1);
        stack.splice(next, 0, entry);
      }
    }, 'Reorder modifier');
  }

  function clear(mesh = editor.selected) {
    if (!isEditableMesh(mesh) || !stackOf(mesh).length) return false;
    const source = sourceFor(mesh);
    if (!source) return false;
    editor.checkpoint('Clear modifier stack');
    const previous = mesh.geometry;
    mesh.geometry = source.clone();
    mesh.userData[STACK_KEY] = [];
    disposeGeometryIfUnreferenced(editor, previous);
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
    sourceByMesh.delete(mesh);
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
    const root = cloneSkeleton(editor.modelRoot);
    const originals = new Map();
    editor.modelRoot.traverse((object) => {
      const id = object.userData?.gluestackId;
      if (id) originals.set(id, object);
    });
    const ownedGeometries = [];
    root.traverse((object) => {
      if (!object.isMesh) return;
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
      <div class="modifier-stack-note">Неразрушающий порядок сверху вниз. Edit/UV для Mesh со stack требуют Apply Stack.</div>
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
      .modifier-stack-note{font-size:10px;color:#929292;line-height:1.35;margin-bottom:7px}.modifier-stack-list{display:grid;gap:4px}.modifier-stack-empty{padding:7px;border:1px dashed #484848;border-radius:3px;color:#858585;text-align:center;font-size:10px}.modifier-stack-item{display:grid;grid-template-columns:24px minmax(0,1fr) 24px 24px 24px;gap:3px;align-items:center;padding:3px;background:#252525;border:1px solid #414141;border-radius:3px}.modifier-stack-item.disabled{opacity:.5}.modifier-stack-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.modifier-stack-item button,.modifier-stack-actions button{min-height:24px;border:1px solid #454545;border-radius:3px;background:#323232;color:#ddd;display:flex;align-items:center;justify-content:center;gap:4px}.modifier-stack-item button:hover,.modifier-stack-actions button:hover{background:#484848}.modifier-stack-actions{display:grid;grid-template-columns:1fr .65fr;gap:4px;margin-top:6px}.modifier-stack-actions button{font-size:10px}`;
    document.head.appendChild(style);
  }

  function render() {
    if (!list) return;
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
    stack.forEach((item) => {
      const row = document.createElement('div');
      row.className = `modifier-stack-item${item.enabled === false ? ' disabled' : ''}`;
      row.innerHTML = `
        <button type="button" data-stack-toggle title="Enable/Disable"><i data-lucide="${item.enabled === false ? 'eye-off' : 'eye'}"></i></button>
        <span title="${descriptorLabel(item)}">${descriptorLabel(item)}</span>
        <button type="button" data-stack-up title="Move up"><i data-lucide="chevron-up"></i></button>
        <button type="button" data-stack-down title="Move down"><i data-lucide="chevron-down"></i></button>
        <button type="button" data-stack-remove title="Remove"><i data-lucide="x"></i></button>`;
      row.querySelector('[data-stack-toggle]').addEventListener('click', () => toggle(mesh, item.id));
      row.querySelector('[data-stack-up]').addEventListener('click', () => move(mesh, item.id, -1));
      row.querySelector('[data-stack-down]').addEventListener('click', () => move(mesh, item.id, 1));
      row.querySelector('[data-stack-remove]').addEventListener('click', () => remove(mesh, item.id));
      list.appendChild(row);
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
    clear,
    hasStack,
    rebuild,
    render,
    restoreAll,
    stackOf,
    createProjectExportRoot,
    disposeProjectExportRoot,
  };
  modifiers.stack = api;
  editor.modifierStack = api;
  render();
  return api;
}
