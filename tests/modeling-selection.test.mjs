import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { bindKeyboard } from '../src/keyboard.js';
import { EditModeController } from '../src/edit/controller.js';
import { installSelectionTools } from '../src/runtime/selection-tools.js';
import { installBoxSelect } from '../src/runtime/box-select.js';
import { installCircleSelect } from '../src/runtime/circle-select.js';
import { segmentIntersectsRect, segmentDistanceSquared } from '../src/runtime/selection-geometry.js';

function setup(mode = 'object') {
  const dom = new JSDOM('<canvas></canvas>', { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const canvas = document.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 500, width: 400, height: 400 });
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 20);
  camera.position.z = 10; camera.updateMatrixWorld();
  const editor = {
    camera, modelRoot: new THREE.Group(), renderer: { domElement: canvas },
    orbit: { enabled: true }, transform: { enabled: true }, selected: null, selectedObjects: [],
    events: { onStatus() {} }, getSelectedObjects() { return this.selectedObjects; },
    selectMany(objects, active) { assert.ok(objects.includes(active)); this.selectedObjects = objects; this.selected = active; },
    clearSelection() { this.selectedObjects = []; this.selected = null; },
  };
  const mesh = new THREE.Mesh();
  const editMode = Object.assign(Object.create(EditModeController.prototype), {
    editor, active: mode !== 'object', selectionMode: mode, mesh,
    vertices: [[-1, -1], [1, 1], [-1, 1], [1, -1], [1.5, 1.5], [1.8, 1.8]].map(([x,y]) => ({ position: new THREE.Vector3(x,y,0) })),
    edges: [{ a: 0, b: 1, key: '0:1' }, { a: 0, b: 2, key: '0:2' }, { a: 2, b: 1, key: '1:2' }, { a: 4, b: 5, key: '4:5' }],
    logicalEdges: [{ a: 0, b: 2, key: '0:2' }, { a: 2, b: 1, key: '1:2' }, { a: 4, b: 5, key: '4:5' }],
    triangles: [{ v: [0, 1, 2] }, { v: [1, 0, 3] }], faceGroups: [{ id: 0, triangles: [0, 1] }],
    selectedVertices: new Set(), selectedEdges: new Set(), selectedFaces: new Set(),
    refreshOverlay() {}, updatePivot() {}, emitChange() {}, status() {},
  });
  const selection = installSelectionTools({ editor, editMode });
  const box = installBoxSelect({ editor, editMode });
  const circle = installCircleSelect({ editor, editMode });
  function pointer(target, type, x, y, options = {}) {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...options });
    Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 });
    target.dispatchEvent(event);
  }
  function drag(x1, y1, x2, y2, options = {}) {
    box.begin(); pointer(canvas, 'pointerdown', x1, y1, options); pointer(window, 'pointerup', x2, y2, options);
  }
  function paint(x, y, options = {}) { circle.begin(); pointer(canvas, 'pointerdown', x, y, options); pointer(window, 'pointerup', x, y, options); }
  return { dom, editor, editMode, selection, box, circle, canvas, pointer, drag, paint };
}

function addObjects(editor) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2));
  const hidden = new THREE.Group(); hidden.visible = false; hidden.add(mesh.clone());
  const light = new THREE.PointLight(); light.position.x = 1;
  editor.modelRoot.add(mesh, hidden, light);
  return { mesh, hidden, light };
}

test('Object All / Invert / None skip hidden descendants and collection containers', () => {
  const { editor, selection } = setup(); const { mesh, light } = addObjects(editor);
  selection.objectSelectAll(); assert.deepEqual(editor.getSelectedObjects(), [mesh, light]);
  editor.selectMany([mesh], mesh); selection.objectInvert(); assert.deepEqual(editor.getSelectedObjects(), [light]);
  selection.objectSelectNone(); assert.equal(editor.getSelectedObjects().length, 0);
});

test('Edit All / Invert / None agree on logical edges, vertices and faces', () => {
  const { editMode, selection } = setup('edge');
  for (const mode of ['vertex', 'edge', 'face']) {
    editMode.selectionMode = mode; editMode.selectAll();
    assert.equal(editMode.currentSelectionSet().size, mode === 'vertex' ? 6 : mode === 'edge' ? 3 : 1);
    selection.editInvert(); assert.equal(editMode.currentSelectionSet().size, 0);
    selection.editInvert(); editMode.deselectAll(); assert.equal(editMode.currentSelectionSet().size, 0);
  }
});

test('Linked expands only seeded connected islands and excludes internal diagonals', () => {
  const { editMode, selection } = setup('edge'); editMode.selectedEdges.add('0:2');
  selection.editLinked(); assert.deepEqual([...editMode.selectedEdges], ['0:2', '1:2']);
  editMode.selectionMode = 'vertex'; editMode.selectedVertices.add(4); selection.editLinked();
  assert.deepEqual([...editMode.selectedVertices].sort(), [4, 5]);
});

test('Box selects geometry and light origins, adds/subtracts and ignores hidden objects', () => {
  const { editor, drag } = setup(); const { mesh, light } = addObjects(editor);
  drag(285,285,315,315); assert.deepEqual(editor.getSelectedObjects(), [mesh]);
  drag(395,295,405,305, { shiftKey: true }); assert.deepEqual(editor.getSelectedObjects(), [mesh, light]);
  drag(285,285,315,315, { ctrlKey: true }); assert.deepEqual(editor.getSelectedObjects(), [light]);
  drag(110,110,115,115); assert.equal(editor.getSelectedObjects().length, 0);
});

test('Box edge hits require actual intersection and ignore triangulation diagonals', () => {
  const { editMode, drag } = setup('edge');
  // (200,400) -> (200,200) is a logical vertical edge; (200,400) -> (400,200) is internal.
  drag(290,290,310,310); assert.equal(editMode.selectedEdges.size, 0);
  drag(190,290,210,310); assert.deepEqual([...editMode.selectedEdges], ['0:2']);
  drag(190,290,210,310, { ctrlKey: true }); assert.equal(editMode.selectedEdges.size, 0);
  assert.equal(segmentIntersectsRect({x:0,y:0}, {x:100,y:100}, {left:0,right:10,top:90,bottom:100}), false);
});

test('Circle edge brush hits entire segment, excludes diagonals and supports subtraction', () => {
  const { editMode, circle, paint } = setup('edge');
  paint(200,260); assert.deepEqual([...editMode.selectedEdges], ['0:2']);
  paint(200,260, { ctrlKey: true }); assert.equal(editMode.selectedEdges.size, 0);
  paint(300,300); assert.equal(editMode.selectedEdges.size, 0); circle.finish();
  assert.equal(segmentDistanceSquared({x:0,y:0}, {x:0,y:0}, {x:0,y:0}), 0);
});

test('Box and Circle select vertex and face modes', () => {
  const { editMode, drag, paint, circle } = setup('vertex');
  drag(195,195,205,205); assert.deepEqual([...editMode.selectedVertices], [2]);
  paint(400,400); assert.ok(editMode.selectedVertices.has(3)); circle.finish();
  editMode.selectionMode = 'face'; drag(290,290,310,310); assert.deepEqual([...editMode.selectedFaces], [0]);
  paint(300,300, { metaKey: true }); assert.equal(editMode.selectedFaces.size, 0);
});

test('Circle ignores off-canvas strokes and unrelated pointers', () => {
  const { editor, circle, canvas, pointer } = setup(); const { light } = addObjects(editor);
  light.position.x = 2.2;
  circle.begin(); pointer(canvas, 'pointerdown', 450,300);
  pointer(window, 'pointermove', 520,300); assert.equal(editor.getSelectedObjects().length, 0);
  pointer(window, 'pointerup', 520,300, { pointerId: 2 });
  pointer(window, 'pointermove', 300,300); assert.equal(editor.getSelectedObjects().length, 1);
  circle.finish();
});

test('Tools restore previous orbit/gizmo states, cancel on blur/cancel, and exclude each other', () => {
  const { editor, box, circle, canvas, pointer } = setup(); editor.orbit.enabled = false;
  box.begin(); assert.equal(editor.transform.enabled, false); circle.begin();
  assert.equal(box.active, false); assert.equal(circle.active, true);
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(circle.active, false); assert.equal(editor.orbit.enabled, false); assert.equal(editor.transform.enabled, true);
  box.begin(); pointer(canvas, 'pointerdown', 200,200); pointer(window, 'pointercancel',200,200);
  assert.equal(box.active, false); assert.equal(document.querySelector('.box-select-overlay').hidden, true);
  circle.finish(); assert.equal(editor.orbit.enabled, false);
});

test('Opening Home cancels selection and prevents new tools', async () => {
  const { box, circle, editor } = setup(); box.begin();
  document.body.classList.add('gluestack-home-open'); await Promise.resolve();
  assert.equal(box.active, false); assert.equal(editor.transform.enabled, true);
  assert.equal(circle.begin(), false);
});


test('Select menu routes Object/Edit actions; Escape/Enter finish tools; form controls keep keys', () => {
  const { editor, editMode, box, circle } = setup(); const { mesh } = addObjects(editor);
  for (const key of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) globalThis[key] = window[key];
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  bindKeyboard({ editor, editMode, knifeTool: { active: false }, transformModal: { state: null, handleKey: () => false } });
  function action(name) {
    const button = document.createElement('button'); button.dataset.action = name; document.body.append(button); button.click();
  }
  function key(code, target = window) { target.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })); }
  action('select-all'); assert.ok(editor.getSelectedObjects().includes(mesh));
  action('select-none'); assert.equal(editor.getSelectedObjects().length, 0);
  action('select-box'); assert.equal(box.active, true); key('Escape'); assert.equal(box.active, false);
  action('select-circle'); assert.equal(circle.active, true); key('Enter'); assert.equal(circle.active, false);
  editMode.active = true; editMode.selectionMode = 'edge';
  action('select-all'); assert.equal(editMode.selectedEdges.size, 3);
  action('select-invert'); assert.equal(editMode.selectedEdges.size, 0);
  editMode.selectedEdges.add('0:2'); action('select-linked'); assert.equal(editMode.selectedEdges.size, 2);
  action('select-none'); assert.equal(editMode.selectedEdges.size, 0);
  const select = document.createElement('select'); document.body.append(select); key('KeyB', select); assert.equal(box.active, false);
});
