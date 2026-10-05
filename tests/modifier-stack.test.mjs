import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Editor3D } from '../src/editor.js';
import { ModifierController } from '../src/modifiers/controller.js';
import { installModifierStack } from '../src/modifiers/stack.js';
import { installResourceOwnership } from '../src/runtime/resource-ownership.js';
import { installModifierStackDiagnostics } from '../src/runtime/modifier-stack-diagnostics.js';
import { PROJECT_FORMAT, encodeProjectContainer, decodeProjectContainer } from '../src/projects/format.js';

function setup() {
  const dom = new JSDOM('<div id="modifier-properties"></div>', { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.Blob = dom.window.Blob;
  const editor = Object.create(Editor3D.prototype);
  Object.assign(editor, {
    modelRoot: new THREE.Group(), selected: null, selectedObjects: new Set(),
    undoStack: [], redoStack: [], pendingHistory: null,
    events: { onSelection() {}, onStructure() {}, onTransform() {}, onHistory() {}, onStatus(message) { editor.status = message; } },
    refreshSelectionVisuals() {},
  });
  installResourceOwnership(editor);
  const stack = installModifierStack({ editor, modifiers: new ModifierController(editor) });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  mesh.name = 'Cube';
  editor.modelRoot.add(mesh);
  editor.select(mesh);
  return { editor, stack, mesh, dom };
}

function positions(mesh, world = false) {
  mesh.updateWorldMatrix(true, false);
  const attribute = mesh.geometry.getAttribute('position');
  return Array.from({ length: attribute.count }, (_, i) => {
    const point = new THREE.Vector3().fromBufferAttribute(attribute, i);
    if (world) point.applyMatrix4(mesh.matrixWorld);
    return point.toArray();
  });
}

function samePoints(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((point, i) => point.forEach((value, axis) => assert.ok(Math.abs(value - expected[i][axis]) < 1e-5, `${i}/${axis}: ${value} != ${expected[i][axis]}`)));
}

test('last modifier removal followed by add does not apply transform twice', () => {
  const { editor, stack, mesh } = setup();
  stack.add('triangulate');
  mesh.position.set(3, 2, 1);
  mesh.scale.set(2, 1, 0.5);
  editor.applyTransform();
  const expected = positions(mesh, true);
  stack.stackOf(mesh).length = 0;
  assert.equal(stack.rebuild(mesh), true);
  assert.equal(stack.add('triangulate'), true);
  samePoints(positions(mesh, true), expected);
});

test('failed stack does not reset transforms or leave a post matrix', () => {
  const { editor, stack, mesh } = setup();
  stack.add('triangulate');
  stack.stackOf(mesh)[0].type = 'unsupported';
  mesh.position.set(3, 2, 1);
  mesh.scale.set(2, 1, 0.5);
  const expected = positions(mesh, true);
  const history = editor.undoStack.length;
  const originalError = console.error;
  try {
    console.error = () => {};
    assert.equal(editor.applyTransform(), false);
  } finally { console.error = originalError; }
  samePoints(positions(mesh, true), expected);
  assert.deepEqual(mesh.position.toArray(), [3, 2, 1]);
  assert.equal(mesh.userData.gluestackModifierPostMatrix, undefined);
  assert.equal(editor.undoStack.length, history);
});

test('origin does not move children silently', () => {
  const { editor, mesh } = setup();
  mesh.geometry.translate(2, 0, 0);
  const child = new THREE.Object3D();
  child.position.set(1, 2, 3);
  mesh.add(child);
  const before = child.getWorldPosition(new THREE.Vector3());
  assert.equal(editor.originToGeometry(), false);
  assert.deepEqual(child.getWorldPosition(new THREE.Vector3()).toArray(), before.toArray());
});

test('mixed selection is rejected before any geometry or history mutation', () => {
  const { editor, mesh } = setup();
  mesh.position.x = 3;
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), mesh.material, 2);
  editor.modelRoot.add(instanced);
  editor.selectMany([mesh, instanced]);
  const before = mesh.geometry;
  assert.equal(editor.applyTransform(), false);
  assert.equal(mesh.geometry, before);
  assert.equal(mesh.position.x, 3);
  assert.equal(editor.undoStack.length, 0);
});

test('unchanged rebuild and suffix edit reuse the cached prefix', () => {
  const { stack, mesh } = setup();
  stack.add('mirror', { axis: 'x' });
  stack.add('array', { count: 2, x: 3 });
  const source = stack.sourceFor(mesh);
  let sourceClones = 0;
  const clone = source.clone.bind(source);
  source.clone = () => { sourceClones++; return clone(); };
  assert.equal(stack.rebuild(mesh), true);
  assert.equal(sourceClones, 0);
  assert.equal(stack.updateParam(mesh, stack.stackOf(mesh)[1].id, 'count', 3), true);
  assert.equal(sourceClones, 1, 'only the Undo snapshot clones source; prefix is reused');
  assert.equal(stack.debugCacheStats().cachedGeometries, 2);
});

test('duplicate source is independent and undo/redo preserves both stacks', () => {
  const { editor, stack, mesh } = setup();
  stack.add('array', { count: 2, x: 3 });
  const [copy] = editor.duplicateSelected();
  assert.notEqual(stack.sourceFor(mesh), stack.sourceFor(copy));
  assert.notEqual(stack.stackOf(mesh)[0].id, stack.stackOf(copy)[0].id);
  const original = positions(mesh);
  stack.updateParam(copy, stack.stackOf(copy)[0].id, 'count', 3);
  samePoints(positions(mesh), original);
  assert.equal(editor.undo(), true);
  assert.equal(editor.selected.geometry.getAttribute('position').count, mesh.geometry.getAttribute('position').count);
  assert.equal(editor.redo(), true);
  assert.equal(stack.stackOf(editor.selected)[0].params.count, 3);
});

test('apply transform and origin preserve world vertices under a transformed parent', () => {
  const { editor, stack, mesh } = setup();
  const parent = new THREE.Group();
  parent.position.set(-1, 2, 3);
  parent.rotation.set(0.2, 0.3, 0.4);
  parent.scale.set(0.5, 2, 1);
  editor.modelRoot.add(parent);
  parent.add(mesh);
  stack.add('array', { count: 2, x: 3 });
  mesh.position.set(1, 2, 3);
  mesh.rotation.set(0.1, -0.2, 0.3);
  mesh.scale.set(2, 1, 0.5);
  const expected = positions(mesh, true);
  assert.equal(editor.applyTransform(), true);
  samePoints(positions(mesh, true), expected);
  assert.equal(editor.originToGeometry(), true);
  samePoints(positions(mesh, true), expected);
  assert.equal(stack.rebuild(mesh), true);
  samePoints(positions(mesh, true), expected);
  assert.equal(editor.undo(), true);
  samePoints(positions(editor.selected, true), expected);
});

test('project source export/open restores geometry, descriptors and post transform', () => {
  const { editor, stack, mesh } = setup();
  stack.add('mirror', { axis: 'x' });
  stack.add('array', { count: 2, x: 3 });
  mesh.position.set(1, 2, 3);
  editor.applyTransform();
  const expected = positions(mesh, true);
  const payload = stack.createProjectExportRoot();
  const imported = new THREE.ObjectLoader().parse(payload.root.toJSON());
  stack.disposeProjectExportRoot(payload);
  editor.clearSelection();
  editor.modelRoot = imported;
  stack.restoreAll();
  const restored = imported.children[0];
  assert.equal(stack.stackOf(restored).length, 2);
  samePoints(positions(restored, true), expected);
});

test('apply, clear, bake and delete release source and intermediate geometry', () => {
  for (const operation of ['apply', 'clear', 'bake', 'delete']) {
    const { editor, stack, mesh } = setup();
    stack.add('mirror', { axis: 'x' });
    const source = stack.sourceFor(mesh);
    let disposed = 0;
    source.addEventListener('dispose', () => { disposed++; });
    if (operation === 'bake') stack.bakeThrough(mesh, stack.stackOf(mesh)[0].id);
    else if (operation === 'delete') { editor.deleteSelected(); stack.pruneCaches(); }
    else stack[operation](mesh);
    assert.equal(disposed, 1, operation);
    assert.equal(stack.debugCacheStats().sourceEntries, 0, operation);
    assert.equal(stack.debugCacheStats().cacheEntries, 0, operation);
  }
});

test('failed suffix does not partially bake source or remove descriptors', () => {
  const { editor, stack, mesh } = setup();
  stack.add('triangulate');
  stack.add('array', { count: 2, x: 3 });
  stack.stackOf(mesh)[1].type = 'unsupported';
  const before = mesh.geometry;
  const source = stack.sourceFor(mesh);
  const history = editor.undoStack.length;
  assert.equal(stack.bakeThrough(mesh, stack.stackOf(mesh)[0].id), false);
  assert.equal(mesh.geometry, before);
  assert.equal(stack.sourceFor(mesh), source);
  assert.equal(stack.stackOf(mesh).length, 2);
  assert.equal(editor.undoStack.length, history);
  assert.equal(stack.apply(mesh), false);
  assert.equal(mesh.geometry, before);
  assert.equal(stack.stackOf(mesh).length, 2);
});

test('real Diagnostics suite retains temporary caches and leaves user scene/history intact', async () => {
  const { editor, stack, mesh } = setup();
  stack.add('array', { count: 2, x: 3 });
  const baseline = stack.debugCacheStats();
  const before = positions(mesh);
  const history = editor.undoStack.length;
  const menu = document.createElement('details');
  menu.innerHTML = '<div class="menu-popover"></div>';
  document.body.appendChild(menu);
  const suite = installModifierStackDiagnostics({ editor, modifierStack: stack, diagnostics: { menu } });
  const originalTable = console.table;
  let checks;
  try { console.table = () => {}; checks = await suite.run(); }
  finally { console.table = originalTable; }
  assert.deepEqual(checks.filter(check => !check.ok), []);
  assert.deepEqual(stack.debugCacheStats(), baseline);
  assert.equal(editor.modelRoot.children.length, 1);
  assert.equal(editor.selected, mesh);
  assert.equal(editor.undoStack.length, history);
  samePoints(positions(mesh), before);
});

test('imported multi-material GLB keeps groups and UV through Duplicate and Apply Transform', async () => {
  const { editor, stack, mesh } = setup();
  mesh.material = [new THREE.MeshStandardMaterial({ color: 0xff0000 }), new THREE.MeshStandardMaterial({ color: 0x00ff00 })];
  mesh.geometry.groups.forEach((group, i) => { group.materialIndex = i % 2; });
  const glb = await new GLTFExporter().parseAsync(mesh, { binary: true });
  const imported = await new GLTFLoader().parseAsync(glb, '');
  editor.modelRoot.remove(mesh);
  editor.modelRoot.add(imported.scene);
  // GLTFLoader represents multiple primitives as sibling meshes. Consolidate
  // two imported slots to exercise the editor's multi-material geometry path.
  const primitives = [];
  imported.scene.traverse(object => { if (object.isMesh) primitives.push(object); });
  const importedMesh = new THREE.Mesh(mergeGeometries(primitives.slice(0, 2).map(object => object.geometry), true), primitives.slice(0, 2).map(object => object.material));
  editor.modelRoot.remove(imported.scene);
  editor.modelRoot.add(importedMesh);
  assert.equal(importedMesh.isMesh, true);
  editor.select(importedMesh);
  assert.equal(stack.add('array', { count: 2, x: 3 }), true);
  const [copy] = editor.duplicateSelected();
  copy.scale.set(2, 1, 0.5);
  const expected = positions(copy, true);
  assert.equal(editor.applyTransform(), true);
  assert.equal(stack.rebuild(copy), true);
  samePoints(positions(copy, true), expected);
  assert.equal(copy.material.length, 2);
  assert.deepEqual(new Set(copy.geometry.groups.map(group => group.materialIndex)), new Set([0, 1]));
  assert.equal(copy.geometry.getAttribute('uv').count, copy.geometry.getAttribute('position').count);
});

test('12 binary .gluestack reopen cycles retain source shape and release previous caches', async () => {
  const { editor, stack, mesh } = setup();
  stack.add('array', { count: 2, x: 3 });
  mesh.position.set(1, 2, 3);
  editor.applyTransform();
  const expected = positions(mesh, true);
  const payload = stack.createProjectExportRoot();
  const glb = await new GLTFExporter().parseAsync(payload.root, { binary: true });
  stack.disposeProjectExportRoot(payload);
  const container = encodeProjectContainer({ format: PROJECT_FORMAT, version: 2, name: 'Stack fixture' }, glb);
  for (let i = 0; i < 12; i++) {
    const oldMesh = editor.modelRoot.children[0];
    const oldSource = stack.sourceFor(oldMesh);
    let disposed = 0;
    oldSource.addEventListener('dispose', () => { disposed++; });
    const decoded = decodeProjectContainer(container);
    const parsed = await new GLTFLoader().parseAsync(decoded.glb, '');
    editor.clearSelection();
    const previous = editor.modelRoot;
    editor.modelRoot = parsed.scene.children[0];
    editor.disposeObjectResources(previous);
    assert.equal(stack.restoreAll(), 1);
    const reopened = editor.modelRoot.children[0];
    editor.select(reopened);
    samePoints(positions(reopened, true), expected);
    assert.equal(disposed, 1, `cycle ${i}`);
    assert.equal(stack.debugCacheStats().sourceEntries, 1);
    assert.equal(stack.debugCacheStats().cacheEntries, 1);
    assert.equal(stack.debugCacheStats().cachedGeometries, 1);
  }
});
