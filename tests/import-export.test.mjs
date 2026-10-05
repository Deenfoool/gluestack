import assert from 'node:assert/strict';
import { test } from 'node:test';
import { File } from 'node:buffer';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Editor3D } from '../src/editor.js';
import { installAnimations } from '../src/runtime/animations.js';
import { exportCleanGlbBuffer } from '../src/runtime/export-clean.js';
import { importSelectedFiles, parseSelectedFiles, installImportPipeline } from '../src/runtime/importer.js';
import { installResourceOwnership } from '../src/runtime/resource-ownership.js';
import { makeHomeImporter } from '../src/features.js';
import { installImportExportDiagnostics } from '../src/runtime/import-export-diagnostics.js';

function setup() {
  const dom = new JSDOM('<input id="file-input">', { url: 'https://example.test' });
  for (const key of ['window', 'document', 'CustomEvent', 'FileReader', 'Blob', 'ProgressEvent']) globalThis[key] = dom.window[key] ?? dom.window;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const editor = Object.create(Editor3D.prototype);
  Object.assign(editor, {
    modelRoot: new THREE.Group(), selected: null, selectedObjects: new Set(),
    undoStack: [], redoStack: [], pendingHistory: null,
    loader: new GLTFLoader(), exporter: new GLTFExporter(),
    transform: new THREE.EventDispatcher(),
    events: { onSelection() {}, onStructure() {}, onTransform() {}, onHistory() {}, onStatus(message) { editor.status = message; } },
    refreshSelectionVisuals() {},
  });
  installResourceOwnership(editor);
  installAnimations(editor);
  return editor;
}

const gltfFile = (json, name = 'fixture.gltf') => new File([JSON.stringify(json)], name);
const clipFor = name => new THREE.AnimationClip('Move', 1, [new THREE.VectorKeyframeTrack(`${name}.position`, [0, 1], [0, 0, 0, 2, 0, 0])]);

test('AnimationClip registration, independent history copy and Undo/Redo retain tracks', () => {
  const editor = setup();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.name = 'Animated';
  editor.modelRoot.add(mesh);
  editor.select(mesh);
  const source = clipFor(mesh.name);
  assert.equal(editor.registerAnimations([source], { replace: true }).length, 1);
  assert.notEqual(editor.animations[0], source);
  const state = editor.captureState();
  assert.equal(state.animations.length, 1);
  assert.notEqual(state.animations[0].tracks[0].values, editor.animations[0].tracks[0].values);
  editor.checkpoint('Replace clips');
  editor.registerAnimations([], { replace: true });
  assert.equal(editor.undo(), true);
  assert.equal(editor.animations[0].tracks[0].name, 'Animated.position');
  assert.equal(editor.redo(), true);
  assert.equal(editor.animations.length, 0);
});

test('animated import name collisions retarget each track once', async () => {
  const editor = setup();
  const existing = new THREE.Object3D(); existing.name = 'A'; editor.modelRoot.add(existing);
  const root = new THREE.Group();
  const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); first.name = 'A';
  const second = first.clone(); second.name = 'A.001'; root.add(first, second);
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: [clipFor('A'), clipFor('A.001')] });
  const imported = await importSelectedFiles(editor, [new File([glb], 'animated.glb')]);
  const nodes = []; imported.traverse(node => { if (node.isMesh) nodes.push(node); });
  assert.equal(editor.animations.length, 2);
  assert.equal(editor.animations[0].tracks[0].name, `${nodes[0].name}.position`);
  assert.equal(editor.animations[1].tracks[0].name, `${nodes[1].name}.position`);
});

test('unknown required extensions are rejected before touching the live project', async () => {
  const editor = setup();
  const existing = new THREE.Object3D(); editor.modelRoot.add(existing);
  const file = gltfFile({ asset: { version: '2.0' }, extensionsRequired: ['VENDOR_unsupported'], scenes: [{}], scene: 0 });
  await assert.rejects(importSelectedFiles(editor, [file]), /VENDOR_unsupported/);
  assert.deepEqual(editor.modelRoot.children, [existing]);
  assert.equal(editor.undoStack.length, 0);
});

test('replace import validates before deleting old scene and keeps undoable successful replacement', async () => {
  const editor = setup();
  const existing = new THREE.Object3D(); existing.name = 'Old'; editor.modelRoot.add(existing); editor.select(existing);
  editor.registerAnimations([clipFor('Old')], { replace: true });
  await assert.rejects(importSelectedFiles(editor, [new File(['broken'], 'broken.gltf')], { replace: true }));
  assert.deepEqual(editor.modelRoot.children, [existing]);
  assert.equal(editor.selected, existing);
  assert.equal(editor.animations.length, 1);
  const imported = await importSelectedFiles(editor, [gltfFile({ asset: { version: '2.0' }, nodes: [{ name: 'New' }], scenes: [{ nodes: [0] }], scene: 0 })], { replace: true });
  assert.deepEqual(editor.modelRoot.children, [imported]);
  assert.equal(editor.animations.length, 0);
  assert.equal(editor.undo(), true);
  assert.equal(editor.modelRoot.children[0].name, 'Old');
  assert.equal(editor.animations.length, 1);
});

test('concurrent imports keep sidecar URL maps isolated', async () => {
  const editor = setup();
  const observed = [];
  editor.loader = {
    manager: new THREE.LoadingManager(),
    parse(payload, _base, resolve) {
      const id = JSON.parse(payload).asset.generator;
      setTimeout(() => {
        observed.push([id, editor.loader.manager.resolveURL('mesh.bin')]);
        resolve({ scene: new THREE.Group(), scenes: [], animations: [] });
      }, id === 'first' ? 15 : 0);
    },
  };
  const first = new File([new Uint8Array([1])], 'mesh.bin');
  const second = new File([new Uint8Array([2])], 'mesh.bin');
  const create = id => gltfFile({ asset: { version: '2.0', generator: id }, buffers: [{ byteLength: 1, uri: 'mesh.bin' }], scenes: [{}] });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = file => file === first ? 'blob:first' : 'blob:second';
  const revoked = []; URL.revokeObjectURL = url => revoked.push(url);
  try {
    await Promise.all([parseSelectedFiles(editor, [create('first'), first]), parseSelectedFiles(editor, [create('second'), second])]);
    assert.deepEqual(observed, [['first', 'blob:first'], ['second', 'blob:second']]);
    assert.deepEqual(revoked, ['blob:first', 'blob:second']);
    assert.equal(editor.loader.manager.resolveURL('mesh.bin'), 'mesh.bin');
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('clean GLB preserves Skin, Morph and animation tracks while stripping editor metadata', async () => {
  const editor = setup();
  const geometry = new THREE.BoxGeometry();
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial()); skin.name = 'Skin';
  const bone = new THREE.Bone(); bone.name = 'Joint'; skin.add(bone); skin.bind(new THREE.Skeleton([bone]));
  const morphGeometry = new THREE.BoxGeometry();
  morphGeometry.morphAttributes.position = [morphGeometry.getAttribute('position').clone()];
  const morph = new THREE.Mesh(morphGeometry, new THREE.MeshStandardMaterial()); morph.name = 'Morph'; morph.updateMorphTargets(); morph.morphTargetInfluences[0] = 0.25;
  morph.userData = { importedExtra: 'keep', gluestackId: 'strip', __gluestackTemp: 'strip' };
  editor.modelRoot.add(skin, morph);
  editor.registerAnimations([
    new THREE.AnimationClip('Rig', 1, [new THREE.QuaternionKeyframeTrack('Joint.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.70710678, 0, 0.70710678])]),
    new THREE.AnimationClip('Shape', 1, [new THREE.NumberKeyframeTrack('Morph.morphTargetInfluences', [0, 1], [0, 1])]),
  ], { replace: true });
  const glb = await exportCleanGlbBuffer(editor);
  const parsed = await new GLTFLoader().parseAsync(glb, '');
  const loadedSkin = parsed.scene.getObjectByName('Skin');
  const loadedMorph = parsed.scene.getObjectByName('Morph');
  assert.equal(loadedSkin.isSkinnedMesh, true);
  assert.equal(loadedSkin.skeleton.bones[0].name, 'Joint');
  assert.equal(loadedMorph.geometry.morphAttributes.position.length, 1);
  assert.equal(loadedMorph.morphTargetInfluences[0], 0.25);
  assert.equal(parsed.animations.length, 2);
  assert.equal(parsed.animations.reduce((sum, clip) => sum + clip.tracks.length, 0), 2);
  assert.equal(loadedMorph.userData.importedExtra, 'keep');
  assert.equal(loadedMorph.userData.gluestackId, undefined);
  assert.equal(loadedMorph.userData.__gluestackTemp, undefined);
  assert.equal(morph.userData.gluestackId, 'strip');
  const mixer = new THREE.AnimationMixer(parsed.scene);
  parsed.animations.forEach(clip => mixer.clipAction(clip).play());
  mixer.setTime(0.5);
  assert.ok(Math.abs(loadedMorph.morphTargetInfluences[0] - 0.5) < 1e-5);
  assert.ok(Math.abs(loadedSkin.skeleton.bones[0].quaternion.y) > 0.3);
  mixer.stopAllAction();
  mixer.uncacheRoot(parsed.scene);
});

test('Home delegates transactional import, initializes features and restores loading flag on failure', async () => {
  const editor = setup();
  const existing = new THREE.Object3D(); existing.name = 'Old'; editor.modelRoot.add(existing); editor.select(existing);
  const projects = { isLoading: false };
  const importer = installImportPipeline({ editor });
  let ready = 0;
  const home = makeHomeImporter({ projects, importer, ensureReady: async () => { ready++; } });
  await assert.rejects(home.importFiles([new File(['broken'], 'bad.gltf')]));
  assert.equal(ready, 1);
  assert.equal(projects.isLoading, false);
  assert.equal(editor.selected, existing);
  assert.deepEqual(editor.modelRoot.children, [existing]);
  assert.equal(editor.undoStack.length, 0);
});

test('sidecar paths resolve relative to the primary folder before ambiguous basenames', async () => {
  const editor = setup();
  const primary = gltfFile({ asset: { version: '2.0' }, buffers: [{ byteLength: 1, uri: '../buffers/mesh.bin' }], scenes: [{}] });
  Object.defineProperty(primary, 'webkitRelativePath', { value: 'asset/models/fixture.gltf' });
  const correct = new File([new Uint8Array([1])], 'mesh.bin');
  const other = new File([new Uint8Array([2])], 'mesh.bin');
  Object.defineProperty(correct, 'webkitRelativePath', { value: 'asset/buffers/mesh.bin' });
  Object.defineProperty(other, 'webkitRelativePath', { value: 'other/mesh.bin' });
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = file => { assert.equal(file, correct); return 'blob:correct'; };
  URL.revokeObjectURL = () => {};
  editor.loader = {
    manager: new THREE.LoadingManager(),
    parse(_payload, _base, resolve) {
      assert.equal(this.manager.resolveURL('../buffers/mesh.bin'), 'blob:correct');
      resolve({ scene: new THREE.Group(), scenes: [], animations: [] });
    },
  };
  try { await parseSelectedFiles(editor, [primary, correct, other]); }
  finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('installed Import / Export Diagnostics suite passes without changing user project', async () => {
  const editor = setup();
  const existing = new THREE.Object3D(); editor.modelRoot.add(existing); editor.select(existing);
  const importer = installImportPipeline({ editor });
  const menu = document.createElement('details'); menu.innerHTML = '<div class="menu-popover"></div>'; document.body.appendChild(menu);
  const suite = installImportExportDiagnostics({ editor, diagnostics: { menu }, importer });
  const originalTable = console.table; console.table = () => {};
  try {
    const checks = await suite.run();
    assert.equal(checks.length, 6);
    assert.deepEqual(checks.filter(check => !check.ok), []);
  } finally { console.table = originalTable; }
  assert.equal(editor.selected, existing);
  assert.deepEqual(editor.modelRoot.children, [existing]);
  assert.equal(editor.undoStack.length, 0);
});

test('damaged GLB lengths, versions and JSON chunks fail before loader or scene mutation', async () => {
  const editor = setup();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); editor.modelRoot.add(mesh); editor.select(mesh);
  const valid = await new GLTFExporter().parseAsync(mesh, { binary: true });
  const malformed = [];
  const length = valid.slice(0); new DataView(length).setUint32(8, valid.byteLength - 4, true); malformed.push(length);
  const version = valid.slice(0); new DataView(version).setUint32(4, 3, true); malformed.push(version);
  const chunk = valid.slice(0); new DataView(chunk).setUint32(12, valid.byteLength, true); malformed.push(chunk);
  const json = valid.slice(0); new Uint8Array(json)[20] = 0; malformed.push(json);
  let calls = 0;
  editor.loader.parse = () => { calls++; };
  for (const payload of malformed) await assert.rejects(importSelectedFiles(editor, [new File([payload], 'damaged.glb')], { replace: true }), /GLB/);
  assert.equal(calls, 0);
  assert.deepEqual(editor.modelRoot.children, [mesh]);
  assert.equal(editor.selected, mesh);
  assert.equal(editor.undoStack.length, 0);
});

test('failed parse releases its resolver and does not block the next queued import', async () => {
  const editor = setup();
  const urls = []; const revoked = [];
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => { const url = `blob:${urls.length}`; urls.push(url); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  editor.loader = {
    manager: new THREE.LoadingManager(),
    parse(payload, _base, resolve, reject) {
      this.manager.resolveURL('mesh.bin');
      if (JSON.parse(payload).asset.generator === 'bad') reject(new Error('bad fixture'));
      else resolve({ scene: new THREE.Group(), scenes: [], animations: [] });
    },
  };
  const file = id => gltfFile({ asset: { version: '2.0', generator: id }, buffers: [{ byteLength: 1, uri: 'mesh.bin' }], scenes: [{}] });
  const buffer = new File([new Uint8Array([1])], 'mesh.bin');
  try {
    const results = await Promise.allSettled([parseSelectedFiles(editor, [file('bad'), buffer]), parseSelectedFiles(editor, [file('good'), buffer])]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    assert.deepEqual(revoked, urls);
    assert.equal(editor.loader.manager.resolveURL('mesh.bin'), 'mesh.bin');
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('URI-encoded literal # stays part of the sidecar filename', () => {
  const editor = setup();
  const importer = installImportPipeline({ editor });
  const file = new File([new Uint8Array([1])], 'part#1.bin');
  const map = new Map([['asset/part#1.bin', [file]]]);
  assert.equal(importer.resolveFile(map, 'part%231.bin?cache=1', 'asset').file, file);
});
