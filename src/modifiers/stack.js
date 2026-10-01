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
const POST_MATRIX_KEY = 'gluestackModifierPostMatrix';
const ERRORS_KEY = '__gluestackModifierErrors';
const SUPPORTED = new Set(['mirror', 'array', 'bevel', 'solidify', 'subdivision', 'decimate', 'triangulate']);
const MATRIX_EPS = 1e-10;

function cloneDescriptor(item, { newId = false } = {}) {
  return {
    id: newId ? makeId() : item.id,
    type: item.type,
    enabled: item.enabled !== false,
    params: structuredClone(item.params ?? {}),
    ui: structuredClone(item.ui ?? {}),
  };
}

function descriptorSignature(item) {
  return JSON.stringify({ type: item.type, enabled: item.enabled !== false, params: item.params ?? {} });
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
    case 'mirror': return `<label><span>Axis</span><select data-stack-param="axis"><option value="x"${p.axis === 'x' || !p.axis ? ' selected' : ''}>X</option><option value="y"${p.axis === 'y' ? ' selected' : ''}>Y</option><option value="z"${p.axis === 'z' ? ' selected' : ''}>Z</option></select></label>`;
    case 'array': return `<label><span>Count</span><input data-stack-param="count" type="number" min="2" max="100" step="1" value="${Math.max(2, Number(p.count) || 2)}"></label><label><span>Offset X</span><input data-stack-param="x" type="number" step="0.1" value="${Number(p.x) || 0}"></label><label><span>Offset Y</span><input data-stack-param="y" type="number" step="0.1" value="${Number(p.y) || 0}"></label><label><span>Offset Z</span><input data-stack-param="z" type="number" step="0.1" value="${Number(p.z) || 0}"></label>`;
    case 'bevel': return `<label><span>Factor</span><input data-stack-param="factor" type="number" min="0.001" max="0.449" step="0.01" value="${Number(p.factor) || 0.08}"></label>`;
    case 'solidify': return `<label><span>Thickness</span><input data-stack-param="thickness" type="number" step="0.01" value="${Number(p.thickness) || 0.1}"></label>`;
    case 'subdivision': return `<label><span>Levels</span><input data-stack-param="levels" type="number" min="1" max="3" step="1" value="${Math.max(1, Number(p.levels) || 1)}"></label>`;
    case 'decimate': return `<label><span>Ratio</span><input data-stack-param="ratio" type="number" min="0.01" max="0.99" step="0.05" value="${THREE.MathUtils.clamp(Number(p.ratio) || 0.5, 0.01, 0.99)}"></label>`;
    default: return '<div class="modifier-stack-no-params">No editable parameters</div>';
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

function matrixIsIdentity(matrix) {
  const identity = new THREE.Matrix4().elements;
  return matrix.elements.every((value, index) => Math.abs(value - identity[index]) <= MATRIX_EPS);
}

function postMatrixOf(mesh) {
  const values = mesh?.userData?.[POST_MATRIX_KEY];
  if (Array.isArray(values) && values.length === 16 && values.every(Number.isFinite)) return new THREE.Matrix4().fromArray(values);
  return new THREE.Matrix4();
}

function setPostMatrix(mesh, matrix) {
  if (!mesh?.userData) return;
  if (matrixIsIdentity(matrix)) delete mesh.userData[POST_MATRIX_KEY];
  else mesh.userData[POST_MATRIX_KEY] = matrix.toArray();
}

function applyPostMatrix(mesh, geometry) {
  const matrix = postMatrixOf(mesh);
  if (!matrixIsIdentity(matrix)) geometry.applyMatrix4(matrix);
  return geometry;
}

export function installModifierStack({ editor, editMode, modifiers }) {
  if (!editor || !modifiers || editor.modifierStack) return editor?.modifierStack ?? null;

  let sourceByMesh = new WeakMap();
  const sourceById = new Map();
  const cacheById = new Map();
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

  function disposeCacheRecord(record) {
    const disposed = new Set();
    for (const geometry of record?.entries ?? []) {
      if (!geometry || disposed.has(geometry)) continue;
      disposed.add(geometry);
      geometry.dispose?.();
    }
  }

  function invalidateCache(meshOrId) {
    const id = typeof meshOrId === 'string' ? meshOrId : meshOrId?.userData?.gluestackId;
    if (!id) return;
    const record = cacheById.get(id);
    if (record) disposeCacheRecord(record);
    cacheById.delete(id);
  }

  function clearAllCaches() {
    for (const source of sourceById.values()) source?.dispose?.();
    sourceById.clear();
    sourceByMesh = new WeakMap();
    for (const record of cacheById.values()) disposeCacheRecord(record);
    cacheById.clear();
  }

  function forgetSource(mesh, dispose = true) {
    if (!mesh?.isMesh) return;
    const id = mesh.userData?.gluestackId;
    const source = sourceByMesh.get(mesh) ?? (id ? sourceById.get(id) : null);
    sourceByMesh.delete(mesh);
    if (id) sourceById.delete(id);
    if (dispose) source?.dispose?.();
    invalidateCache(id);
  }

  function pruneSourceCache() {
    const liveIds = new Set();
    editor.modelRoot.traverse((object) => { if (object.userData?.gluestackId) liveIds.add(object.userData.gluestackId); });
    for (const [id, source] of sourceById) {
      if (liveIds.has(id)) continue;
      sourceById.delete(id);
      source?.dispose?.();
    }
    for (const [id, record] of cacheById) {
      if (liveIds.has(id)) continue;
      disposeCacheRecord(record);
      cacheById.delete(id);
    }
  }

  function setSourceGeometry(mesh, geometry, { clone = true } = {}) {
    if (!isEditableMesh(mesh) || !geometry?.getAttribute?.('position')) return null;
    const id = meshId(mesh);
    const previous = sourceById.get(id);
    const source = clone ? geometry.clone() : geometry;
    source.computeBoundingBox();
    source.computeBoundingSphere();
    sourceByMesh.set(mesh, source);
    sourceById.set(id, source);
    if (previous && previous !== source) previous.dispose?.();
    invalidateCache(id);
    return source;
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
    return setSourceGeometry(mesh, mesh.geometry, { clone: true });
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
    const fakeEditor = { selected: temp, modelRoot: root, checkpoint() {}, refreshSelectionVisuals() {}, assignIds() {}, events: { onTransform() {}, onStructure() {}, onStatus() {} } };
    return { root, controller: new ModifierController(fakeEditor, () => {}) };
  }

  function evaluateDescriptor(temp, controller, item) {
    const p = item.params ?? {};
    switch (item.type) {
      case 'mirror': return controller.applyMirror(['x', 'y', 'z'].includes(p.axis) ? p.axis : 'x');
      case 'array': return controller.applyArray(Math.max(2, Math.min(100, Math.floor(Number(p.count) || 2))), new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0));
      case 'bevel': return applyBevelModifier(controller, Number(p.factor) || 0.08);
      case 'solidify': return controller.applySolidify(Number(p.thickness) || 0.1);
      case 'subdivision': return controller.applySubdivision(Math.max(1, Math.min(3, Math.floor(Number(p.levels) || 1))));
      case 'triangulate': return applyTriangulate(controller);
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
      default: return false;
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

  function evaluateStackCached(mesh, stack, source) {
    const id = meshId(mesh);
    const signatures = stack.map(descriptorSignature);
    const previous = cacheById.get(id);
    let prefix = 0;
    if (previous?.source === source) {
      while (prefix < signatures.length && prefix < previous.signatures.length && previous.signatures[prefix] === signatures[prefix]) prefix += 1;
    }
    const entries = new Array(stack.length).fill(null);
    if (previous?.source === source) for (let index = 0; index < prefix; index += 1) entries[index] = previous.entries[index] ?? null;
    let current = source;
    for (let index = prefix - 1; index >= 0; index -= 1) {
      if (entries[index]) { current = entries[index]; break; }
    }
    const created = [];
    try {
      for (let index = prefix; index < stack.length; index += 1) {
        const item = stack[index];
        if (item.enabled === false) continue;
        const { geometry } = evaluateItems(mesh, [item], current);
        entries[index] = geometry;
        created.push(geometry);
        current = geometry;
      }
      const retained = new Set(entries.filter(Boolean));
      if (previous) {
        const disposed = new Set();
        for (const geometry of previous.entries ?? []) {
          if (!geometry || retained.has(geometry) || disposed.has(geometry)) continue;
          disposed.add(geometry);
          geometry.dispose?.();
        }
      }
      cacheById.set(id, { source, signatures, entries });
      return current.clone();
    } catch (error) {
      for (const geometry of created) geometry.dispose?.();
      invalidateCache(id);
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
      const geometry = evaluateStackCached(mesh, stack, source);
      applyPostMatrix(mesh, geometry);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const previous = mesh.geometry;
      mesh.geometry = geometry;
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
    } finally { rebuilding.delete(mesh); }
  }

  function add(type, params = {}) {
    const mesh = editor.selected;
    if (!isEditableMesh(mesh) || hasMorphData(mesh)) { editor.events.onStatus('Modifier Stack: выберите обычный Mesh без morph targets'); return false; }
    if (!SUPPORTED.has(type)) return false;
    const stack = stackOf(mesh);
    if (!stack.length) captureSource(mesh, true);
    editor.checkpoint(`Add ${type} modifier`);
    stack.push({ id: makeId(), type, enabled: true, params: structuredClone(params), ui: { collapsed: false } });
    const ok = rebuild(mesh); render(); return ok;
  }

  function updateItem(mesh, id, mutate, label = 'Edit modifier stack') {
    const stack = stackOf(mesh);
    const item = stack.find((entry) => entry.id === id);
    if (!item) return false;
    editor.checkpoint(label);
    mutate(item, stack);
    const ok = rebuild(mesh); render(); return ok;
  }

  function updateParam(mesh, id, key, value) { return updateItem(mesh, id, (item) => { item.params ??= {}; item.params[key] = value; }, `Edit ${key} modifier parameter`); }
  function toggle(mesh, id) { return updateItem(mesh, id, (item) => { item.enabled = item.enabled === false; }, 'Toggle modifier'); }
  function toggleCollapsed(mesh, id) { const item = stackOf(mesh).find((entry) => entry.id === id); if (!item) return false; editor.checkpoint('Toggle modifier panel'); item.ui ??= {}; item.ui.collapsed = !item.ui.collapsed; editor.events.onStructure(); render(); return true; }
  function duplicate(mesh, id) { return updateItem(mesh, id, (item, stack) => { const index = stack.indexOf(item); const copy = cloneDescriptor(item, { newId: true }); copy.ui = { ...(copy.ui ?? {}), collapsed: false }; stack.splice(index + 1, 0, copy); }, 'Duplicate modifier'); }
  function remove(mesh, id) { return updateItem(mesh, id, (_item, stack) => { const index = stack.findIndex((entry) => entry.id === id); if (index >= 0) stack.splice(index, 1); }, 'Remove modifier'); }
  function moveTo(mesh, id, targetIndex) { return updateItem(mesh, id, (_item, stack) => { const index = stack.findIndex((entry) => entry.id === id); const next = THREE.MathUtils.clamp(targetIndex, 0, stack.length - 1); if (index >= 0 && next !== index) { const [entry] = stack.splice(index, 1); stack.splice(next, 0, entry); } }, 'Reorder modifier'); }
  function move(mesh, id, delta) { const index = stackOf(mesh).findIndex((entry) => entry.id === id); return index >= 0 ? moveTo(mesh, id, index + delta) : false; }

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
      setSourceGeometry(mesh, baked, { clone: false });
      stack.splice(0, index + 1);
      const ok = rebuild(mesh);
      editor.events.onStatus(ok ? 'Modifier Stack: верхняя часть запечена в source geometry' : 'Bake выполнен, но оставшийся stack содержит ошибку');
      render(); return ok;
    } catch (error) { editor.events.onStatus(`Bake Through: ${error.message || error}`); return false; }
  }

  function clear(mesh = editor.selected) {
    if (!isEditableMesh(mesh) || !stackOf(mesh).length) return false;
    const source = sourceFor(mesh); if (!source) return false;
    editor.checkpoint('Clear modifier stack');
    const geometry = source.clone(); applyPostMatrix(mesh, geometry); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const previous = mesh.geometry; mesh.geometry = geometry; mesh.userData[STACK_KEY] = []; delete mesh.userData[POST_MATRIX_KEY]; delete mesh.userData[ERRORS_KEY];
    disposeGeometryIfUnreferenced(editor, previous); forgetSource(mesh, true);
    editor.refreshSelectionVisuals(); editor.events.onTransform(mesh); editor.events.onStructure();
    editor.events.onStatus('Modifier Stack очищен · source geometry восстановлена, post-transform сохранён в geometry'); render(); return true;
  }

  function apply(mesh = editor.selected) {
    if (!isEditableMesh(mesh) || !stackOf(mesh).length) return false;
    editor.checkpoint('Apply modifier stack');
    mesh.userData[STACK_KEY] = []; delete mesh.userData[POST_MATRIX_KEY]; delete mesh.userData[ERRORS_KEY]; forgetSource(mesh, true);
    editor.refreshSelectionVisuals(); editor.events.onTransform(mesh); editor.events.onStructure(); editor.events.onStatus('Modifier Stack применён к geometry'); render(); return true;
  }

  function hasStack(mesh = editor.selected) { return Boolean(mesh?.isMesh && stackOf(mesh).length); }

  function cloneStackState(sourceRoot, cloneRoot) {
    const sources = []; const clones = [];
    sourceRoot?.traverse?.((object) => sources.push(object)); cloneRoot?.traverse?.((object) => clones.push(object));
    let count = 0;
    for (let index = 0; index < Math.min(sources.length, clones.length); index += 1) {
      const source = sources[index]; const target = clones[index];
      if (!source?.isMesh || !target?.isMesh || !hasStack(source)) continue;
      target.userData[STACK_KEY] = stackOf(source).map((item) => cloneDescriptor(item, { newId: true }));
      const post = source.userData?.[POST_MATRIX_KEY];
      if (Array.isArray(post)) target.userData[POST_MATRIX_KEY] = [...post]; else delete target.userData[POST_MATRIX_KEY];
      const sourceGeometry = sourceFor(source); if (sourceGeometry) setSourceGeometry(target, sourceGeometry, { clone: true });
      rebuild(target, { silent: true }); count += 1;
    }
    return count;
  }

  function applyObjectMatrixToPost(mesh, matrix) { const post = postMatrixOf(mesh); setPostMatrix(mesh, matrix.clone().multiply(post)); return rebuild(mesh, { silent: true }); }
  function translatePost(mesh, offset) { const post = postMatrixOf(mesh); setPostMatrix(mesh, new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z).multiply(post)); return rebuild(mesh, { silent: true }); }

  function installObjectOperationBridge() {
    const originalDuplicate = editor.duplicateSelected.bind(editor);
    editor.duplicateSelected = (...args) => { const sources = editor.getTopLevelSelection(); const clones = originalDuplicate(...args); sources.forEach((source, index) => cloneStackState(source, clones[index])); render(); return clones; };

    editor.applyTransform = () => {
      const meshes = editor.getSelectedObjects().filter((object) => object.isMesh && !object.isSkinnedMesh && object.children.length === 0);
      if (!meshes.length) { editor.events.onStatus('Apply Transform: выберите обычный Mesh без дочерних объектов'); return false; }
      editor.checkpoint('Apply transform'); let stacked = 0;
      for (const mesh of meshes) {
        mesh.updateMatrix(); const matrix = mesh.matrix.clone();
        if (hasStack(mesh)) { applyObjectMatrixToPost(mesh, matrix); stacked += 1; }
        else { const geometry = mesh.geometry.clone(); geometry.applyMatrix4(matrix); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); const previous = mesh.geometry; mesh.geometry = geometry; disposeGeometryIfUnreferenced(editor, previous); }
        mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.set(1, 1, 1); mesh.updateMatrix();
      }
      editor.refreshSelectionVisuals(); editor.events.onTransform(editor.selected); editor.events.onStructure();
      editor.events.onStatus(`Transform применён к ${meshes.length} Mesh${stacked ? ` · stack-safe ${stacked}` : ''}`); return true;
    };

    editor.originToGeometry = () => {
      const meshes = editor.getSelectedObjects().filter((object) => object.isMesh && !object.isSkinnedMesh);
      if (!meshes.length) { editor.events.onStatus('Origin: выберите Mesh'); return false; }
      editor.checkpoint('Origin to geometry'); let stacked = 0;
      for (const mesh of meshes) {
        mesh.geometry.computeBoundingBox(); if (!mesh.geometry.boundingBox) continue;
        const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()); const offset = center.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion);
        if (hasStack(mesh)) { translatePost(mesh, center.clone().multiplyScalar(-1)); stacked += 1; }
        else { const geometry = mesh.geometry.clone(); geometry.translate(-center.x, -center.y, -center.z); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); const previous = mesh.geometry; mesh.geometry = geometry; disposeGeometryIfUnreferenced(editor, previous); }
        mesh.position.add(offset); mesh.updateMatrix();
      }
      editor.refreshSelectionVisuals(); editor.events.onTransform(editor.selected); editor.events.onStructure();
      editor.events.onStatus(`Origin центрирован у ${meshes.length} Mesh${stacked ? ` · stack-safe ${stacked}` : ''}`); return true;
    };
  }

  function installHistoryBridge() {
    const originalCapture = editor.captureState.bind(editor);
    editor.captureState = () => { const state = originalCapture(); state.modifierSources = []; editor.modelRoot.traverse((mesh) => { if (!mesh.isMesh || !hasStack(mesh)) return; const source = sourceFor(mesh); if (source) state.modifierSources.push({ id: meshId(mesh), geometry: source.clone() }); }); return state; };
    const originalDispose = editor.disposeState.bind(editor);
    editor.disposeState = (state) => { for (const entry of state?.modifierSources ?? []) entry.geometry?.dispose?.(); originalDispose(state); };
    const originalRestore = editor.restoreState.bind(editor);
    editor.restoreState = (state) => {
      clearAllCaches(); originalRestore(state);
      const byId = new Map(); editor.modelRoot.traverse((object) => { const id = object.userData?.gluestackId; if (id) byId.set(id, object); });
      for (const entry of state?.modifierSources ?? []) { const mesh = byId.get(entry.id); if (mesh?.isMesh && entry.geometry) setSourceGeometry(mesh, entry.geometry, { clone: true }); }
      editor.modelRoot.traverse((mesh) => { if (mesh.isMesh && hasStack(mesh)) rebuild(mesh, { silent: true }); }); render();
    };
  }

  function createProjectExportRoot() {
    pruneSourceCache(); const root = cloneSkeleton(editor.modelRoot); const originals = new Map();
    editor.modelRoot.traverse((object) => { const id = object.userData?.gluestackId; if (id) originals.set(id, object); });
    const ownedGeometries = [];
    root.traverse((object) => {
      if (!object.isMesh) return; delete object.userData?.[ERRORS_KEY];
      const id = object.userData?.gluestackId; const original = originals.get(id); if (!original || !stackOf(original).length) return;
      const source = sourceFor(original); if (!source) return; object.geometry = source.clone(); ownedGeometries.push(object.geometry); object.userData[STACK_KEY] = stackOf(original).map(cloneDescriptor);
    });
    return { root, ownedGeometries };
  }

  function disposeProjectExportRoot(payload) { for (const geometry of payload?.ownedGeometries ?? []) geometry.dispose(); }

  function restoreAll() {
    clearAllCaches(); const meshes = [];
    editor.modelRoot.traverse((object) => { if (object.isMesh && Array.isArray(object.userData?.[STACK_KEY]) && object.userData[STACK_KEY].length) meshes.push(object); });
    for (const mesh of meshes) captureSource(mesh, true); for (const mesh of meshes) rebuild(mesh, { silent: true }); render();
    if (meshes.length) editor.events.onStatus(`Modifier Stack восстановлен · ${meshes.length} mesh(es)`); return meshes.length;
  }

  function debugCacheStats() {
    const uniqueCacheGeometries = new Set();
    for (const record of cacheById.values()) for (const geometry of record.entries ?? []) if (geometry) uniqueCacheGeometries.add(geometry);
    return { sourceEntries: sourceById.size, cacheEntries: cacheById.size, cachedGeometries: uniqueCacheGeometries.size, sourceIds: [...sourceById.keys()], cacheIds: [...cacheById.keys()] };
  }

  const panelRoot = document.querySelector('#modifier-properties'); let list = null;
  if (panelRoot) {
    const card = document.createElement('div'); card.className = 'modifier-card modifier-stack-card';
    card.innerHTML = `<div class="modifier-title"><i data-lucide="list-tree"></i><span>Modifier Stack</span></div><div class="modifier-stack-note">Неразрушающий порядок сверху вниз. Cache переиспользует неизменённый prefix; Apply Transform/Origin и Duplicate поддерживают активный stack.</div><div class="modifier-stack-list" data-modifier-stack-list></div><div class="modifier-stack-actions"><button type="button" data-stack-apply><i data-lucide="check-check"></i><span>Apply Stack</span></button><button type="button" data-stack-clear><i data-lucide="rotate-ccw"></i><span>Clear</span></button></div>`;
    panelRoot.prepend(card); list = card.querySelector('[data-modifier-stack-list]'); card.querySelector('[data-stack-apply]').addEventListener('click', () => apply()); card.querySelector('[data-stack-clear]').addEventListener('click', () => clear());
    const style = document.createElement('style');
    style.textContent = `.modifier-stack-note{font-size:10px;color:#929292;line-height:1.35;margin-bottom:7px}.modifier-stack-list{display:grid;gap:5px}.modifier-stack-empty{padding:7px;border:1px dashed #484848;border-radius:3px;color:#858585;text-align:center;font-size:10px}.modifier-stack-entry{background:#252525;border:1px solid #414141;border-radius:3px;overflow:hidden}.modifier-stack-entry.disabled{opacity:.55}.modifier-stack-entry.error{border-color:#a85050}.modifier-stack-head{display:grid;grid-template-columns:20px 24px minmax(0,1fr) 24px 24px 24px 24px 24px;gap:2px;align-items:center;padding:3px}.modifier-stack-drag{cursor:grab;color:#888;display:grid;place-items:center}.modifier-stack-head>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.modifier-stack-head button,.modifier-stack-actions button,.modifier-stack-body button{min-height:24px;border:1px solid #454545;border-radius:3px;background:#323232;color:#ddd;display:flex;align-items:center;justify-content:center;gap:4px}.modifier-stack-head button:hover,.modifier-stack-actions button:hover,.modifier-stack-body button:hover{background:#484848}.modifier-stack-body{padding:6px;border-top:1px solid #393939;display:grid;gap:5px}.modifier-stack-body[hidden]{display:none}.modifier-stack-fields{display:grid;grid-template-columns:1fr 1fr;gap:4px}.modifier-stack-fields label{display:grid;grid-template-columns:minmax(52px,.8fr) minmax(0,1fr);align-items:center;gap:4px;font-size:10px;color:#aaa}.modifier-stack-fields input,.modifier-stack-fields select{min-width:0;height:23px;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.modifier-stack-no-params{font-size:10px;color:#888}.modifier-stack-error{font-size:10px;color:#e07b7b;padding:4px;background:rgba(180,60,60,.1);border-radius:3px}.modifier-stack-body-actions{display:flex;justify-content:flex-end}.modifier-stack-body-actions button{font-size:10px;padding:0 7px}.modifier-stack-actions{display:grid;grid-template-columns:1fr .65fr;gap:4px;margin-top:6px}.modifier-stack-actions button{font-size:10px}`;
    document.head.appendChild(style);
  }

  function render() {
    if (!list) return; pruneSourceCache(); const mesh = editor.selected; list.replaceChildren();
    if (!mesh?.isMesh) { const empty = document.createElement('div'); empty.className = 'modifier-stack-empty'; empty.textContent = 'Select Mesh'; list.appendChild(empty); refreshIcons(); return; }
    const stack = stackOf(mesh);
    if (!stack.length) { const empty = document.createElement('div'); empty.className = 'modifier-stack-empty'; empty.textContent = 'Stack is empty'; list.appendChild(empty); refreshIcons(); return; }
    const errors = errorsOf(mesh);
    stack.forEach((item, index) => {
      item.ui ??= { collapsed: false }; const entry = document.createElement('div'); const error = errors[item.id] ?? '';
      entry.className = `modifier-stack-entry${item.enabled === false ? ' disabled' : ''}${error ? ' error' : ''}`; entry.dataset.modifierId = item.id;
      entry.innerHTML = `<div class="modifier-stack-head"><span class="modifier-stack-drag" draggable="true" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span><button type="button" data-stack-collapse title="Collapse/Expand"><i data-lucide="${item.ui.collapsed ? 'chevron-right' : 'chevron-down'}"></i></button><span title="${descriptorLabel(item)}">${descriptorLabel(item)}</span><button type="button" data-stack-toggle title="Enable/Disable"><i data-lucide="${item.enabled === false ? 'eye-off' : 'eye'}"></i></button><button type="button" data-stack-duplicate title="Duplicate"><i data-lucide="copy"></i></button><button type="button" data-stack-up title="Move up"><i data-lucide="chevron-up"></i></button><button type="button" data-stack-down title="Move down"><i data-lucide="chevron-down"></i></button><button type="button" data-stack-remove title="Remove"><i data-lucide="x"></i></button></div><div class="modifier-stack-body"${item.ui.collapsed ? ' hidden' : ''}><div class="modifier-stack-fields">${parameterMarkup(item)}</div>${error ? `<div class="modifier-stack-error">${error}</div>` : ''}<div class="modifier-stack-body-actions"><button type="button" data-stack-bake><i data-lucide="layers"></i><span>Bake Through Here</span></button></div></div>`;
      entry.querySelector('[data-stack-collapse]').addEventListener('click', () => toggleCollapsed(mesh, item.id)); entry.querySelector('[data-stack-toggle]').addEventListener('click', () => toggle(mesh, item.id)); entry.querySelector('[data-stack-duplicate]').addEventListener('click', () => duplicate(mesh, item.id)); entry.querySelector('[data-stack-up]').addEventListener('click', () => move(mesh, item.id, -1)); entry.querySelector('[data-stack-down]').addEventListener('click', () => move(mesh, item.id, 1)); entry.querySelector('[data-stack-remove]').addEventListener('click', () => remove(mesh, item.id)); entry.querySelector('[data-stack-bake]').addEventListener('click', () => bakeThrough(mesh, item.id));
      entry.querySelectorAll('[data-stack-param]').forEach((input) => input.addEventListener('change', () => updateParam(mesh, item.id, input.dataset.stackParam, readParamValue(input))));
      const dragHandle = entry.querySelector('.modifier-stack-drag'); dragHandle.addEventListener('dragstart', (event) => { draggedId = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }); entry.addEventListener('dragover', (event) => { if (!draggedId || draggedId === item.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }); entry.addEventListener('drop', (event) => { event.preventDefault(); const sourceId = draggedId || event.dataTransfer.getData('text/plain'); draggedId = null; if (sourceId && sourceId !== item.id) moveTo(mesh, sourceId, index); }); dragHandle.addEventListener('dragend', () => { draggedId = null; }); list.appendChild(entry);
    });
    refreshIcons();
  }

  const previousSelection = editor.events.onSelection; editor.events.onSelection = (...args) => { previousSelection(...args); render(); };
  if (editMode?.enter) { const originalEnter = editMode.enter.bind(editMode); editMode.enter = (mesh = editor.selected) => { if (hasStack(mesh)) { editor.events.onStatus('Edit Mode: сначала Apply Stack или Clear Stack'); return false; } return originalEnter(mesh); }; }

  installHistoryBridge(); installObjectOperationBridge();

  const api = { add, apply, bakeThrough, clear, duplicate, hasStack, moveTo, rebuild, render, restoreAll, stackOf, updateParam, cloneStackState, setSourceGeometry, sourceFor, releaseMesh: (mesh) => forgetSource(mesh, true), pruneCaches: pruneSourceCache, debugCacheStats, getPostMatrix: postMatrixOf, setPostMatrix, createProjectExportRoot, disposeProjectExportRoot };
  modifiers.stack = api; editor.modifierStack = api; render(); return api;
}
