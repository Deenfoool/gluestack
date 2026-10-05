import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JSDOM } from 'jsdom';
import { EditModeController } from '../src/edit/controller.js';
import { buildTopology, edgeKey } from '../src/edit/topology.js';
import { installAdvancedEditSelection } from '../src/runtime/edit-selection-advanced.js';

function controller(data) {
  const edit = Object.assign(Object.create(EditModeController.prototype), {
    active: true, selectionMode: 'edge', selectedEdges: new Set(), selectedFaces: new Set(), selectedVertices: new Set(),
    updates: 0, refreshOverlay() { this.updates++; }, updatePivot() {}, emitChange() {}, status(message) { this.message = message; },
  }, data);
  edit.updateLogicalEdges();
  edit.api = installAdvancedEditSelection({ editMode: edit });
  return edit;
}

function grid(cols = 4, rows = 4) {
  const vertices = [], triangles = [];
  const id = (x,y) => y * (cols + 1) + x;
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    vertices.push({ position: new THREE.Vector3(x, y, .1 * (x*x + y*y)) });
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = id(x,y), b = id(x+1,y), c = id(x+1,y+1), d = id(x,y+1);
    triangles.push({ v: [a,b,c], materialIndex: 0 }, { v: [a,c,d], materialIndex: 0 });
  }
  const edit = controller({ vertices, triangles, ...buildTopology(vertices, triangles) });
  assert.equal(edit.faceGroups.length, cols * rows);
  assert.ok(edit.faceGroups.every(group => group.boundary.length === 4));
  return { edit, id };
}

function fromGeometry(geometry) {
  const edit = controller({ edges: [], triangleToFaceGroup: [], mesh: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()) });
  edit.loadTopology();
  return edit;
}

function seed(edit, a, b) { edit.selectedEdges = new Set([edgeKey(a,b)]); }

test('Edge Loop expands both directions through regular quad vertices and stops at boundaries', () => {
  const { edit, id } = grid(); seed(edit, id(1,2), id(2,2));
  assert.equal(edit.api.selectEdgeLoop(), true);
  assert.deepEqual(edit.selectedEdges, new Set(Array.from({length:4}, (_,x) => edgeKey(id(x,2),id(x+1,2)))));
  assert.equal(edit.updates, 1);
});

test('Boundary loop follows the full unambiguous perimeter including corners', () => {
  const { edit, id } = grid(3,2); seed(edit,id(0,0),id(1,0)); edit.api.selectEdgeLoop();
  const perimeter = edit.logicalEdges.filter(edge => edit.faceGroups.filter(group => group.boundary.some(item => item.key === edge.key)).length === 1);
  assert.deepEqual(edit.selectedEdges, new Set(perimeter.map(edge => edge.key)));
  assert.equal(edit.selectedEdges.size, 10);
});

test('Real torus logical topology produces closed loops and perpendicular rings without diagonals', () => {
  const edit = fromGeometry(new THREE.TorusGeometry(3,1,7,9));
  assert.equal(edit.faceGroups.length, 63);
  const initial = edit.logicalEdges[0].key; edit.selectedEdges.add(initial);
  assert.equal(edit.api.selectEdgeLoop(), true);
  const loop = new Set(edit.selectedEdges); assert.ok([7,9].includes(loop.size));
  edit.selectedEdges = new Set([initial]); assert.equal(edit.api.selectEdgeRing(), true);
  assert.ok([7,9].includes(edit.selectedEdges.size)); assert.notEqual(edit.selectedEdges.size, loop.size);
  assert.deepEqual(new Set([...loop].filter(key => edit.selectedEdges.has(key))), new Set([initial]));
  assert.ok([...loop, ...edit.selectedEdges].every(key => edit.logicalEdges.some(edge => edge.key === key)));
});

test('Ring crosses opposite quad edges and terminates at open boundaries', () => {
  const { edit, id } = grid(4,3); seed(edit,id(2,1),id(2,2));
  assert.equal(edit.api.selectEdgeRing(),true);
  assert.deepEqual(edit.selectedEdges,new Set(Array.from({length:5},(_,x) => edgeKey(id(x,1),id(x,2)))));
});

test('Loop unions several seeds without switching to their perpendicular ring', () => {
  const { edit, id } = grid(); edit.selectedEdges = new Set([edgeKey(id(1,1),id(2,1)),edgeKey(id(1,3),id(2,3))]);
  edit.api.selectEdgeLoop(); assert.equal(edit.selectedEdges.size,8);
  assert.ok([...edit.selectedEdges].every(key => {
    const edge = edit.logicalEdges.find(edge => edge.key === key);
    return edit.vertices[edge.a].position.y === edit.vertices[edge.b].position.y;
  }));
});

test('Valence-three cube poles and merged planar n-gons have no ambiguous loop expansion', () => {
  const cube = fromGeometry(new THREE.BoxGeometry()); cube.selectedEdges.add(cube.logicalEdges[0].key);
  assert.equal(cube.api.selectEdgeLoop(),false); assert.equal(cube.selectedEdges.size,1); assert.equal(cube.updates,0);
  const plane = fromGeometry(new THREE.PlaneGeometry(4,4,3,3));
  assert.equal(plane.faceGroups.length,1); plane.selectedEdges.add(plane.logicalEdges[0].key);
  assert.equal(plane.api.selectEdgeLoop(),false); assert.equal(plane.api.selectEdgeRing(),false);
});

test('Non-manifold edge cannot extend a ring or continue a loop', () => {
  const { edit, id } = grid(3,3);
  const key = edgeKey(id(1,1),id(1,2));
  const group = edit.faceGroups.find(group => group.boundary.some(edge => edge.key === key));
  edit.faceGroups.push({ ...group, id: 99 });
  edit.selectedEdges = new Set([key]);
  assert.equal(edit.api.selectEdgeRing(),false); assert.equal(edit.api.selectEdgeLoop(),false);
  assert.deepEqual(edit.selectedEdges,new Set([key]));
});

test('Disconnected quad fans sharing a boundary vertex do not bridge loops', () => {
  const { edit, id } = grid(1,1);
  const shared = id(0,0), n = edit.vertices.length;
  edit.vertices.push(...[[0,-1],[-1,-1],[-1,0]].map(([x,y]) => ({position:new THREE.Vector3(x,y,0)})));
  edit.triangles.push({v:[shared,n,n+1],materialIndex:1},{v:[shared,n+1,n+2],materialIndex:1});
  edit.rebuildTopologyOnly(); seed(edit,shared,id(1,0)); edit.api.selectEdgeLoop();
  assert.equal(edit.selectedEdges.size,4);
  assert.ok([...edit.selectedEdges].every(key => edit.logicalEdges.find(edge => edge.key === key).a < n && edit.logicalEdges.find(edge => edge.key === key).b < n));
});

test('Wrong mode, empty seeds and stale/internal edges refuse without changing selection', () => {
  const { edit } = grid();
  for (const action of ['selectEdgeLoop','selectEdgeRing']) {
    assert.equal(edit.api[action](),false);
    edit.selectedEdges = new Set(['missing']); assert.equal(edit.api[action](),false); assert.deepEqual(edit.selectedEdges,new Set(['missing']));
    const internal = edit.edges.find(edge => !edit.logicalEdges.includes(edge));
    edit.selectedEdges = new Set([internal.key]); assert.equal(edit.api[action](),false); assert.deepEqual(edit.selectedEdges,new Set([internal.key]));
    edit.selectionMode = 'vertex'; assert.equal(edit.api[action](),false);
    edit.selectionMode = 'edge'; edit.selectedEdges.clear();
  }
  assert.equal(edit.updates,0);
});

test('Select by Material unions all seed material slots using group IDs, not array positions', () => {
  const edit = controller({edges:[],triangleToFaceGroup:[],triangles:[{materialIndex:0},{materialIndex:1},{materialIndex:2},{materialIndex:1},{materialIndex:3}],
    faceGroups:[{id:10,triangles:[0]},{id:20,triangles:[1]},{id:30,triangles:[2]},{id:40,triangles:[3]},{id:50,triangles:[4]}]});
  edit.selectionMode='face'; edit.selectedFaces=new Set([10,20]);
  assert.equal(edit.api.selectByMaterial(),true); assert.deepEqual(edit.selectedFaces,new Set([10,20,40]));
  edit.selectedFaces.clear(); assert.equal(edit.api.selectByMaterial(),false);
});

test('Select by Material survives actual multi-material GLB export/import', async () => {
  const dom = new JSDOM(); globalThis.FileReader=dom.window.FileReader; globalThis.Blob=dom.window.Blob; globalThis.ProgressEvent=dom.window.ProgressEvent;
  const source = new THREE.Mesh(new THREE.BoxGeometry(),Array.from({length:6},(_,i) => new THREE.MeshStandardMaterial({color:i % 2 ? 'red':'blue'})));
  // Reuse two slots on six faces.
  source.geometry.groups.forEach((group,i) => { group.materialIndex=i%2; });
  source.material=source.material.slice(0,2);
  const original=controller({edges:[],triangleToFaceGroup:[],mesh:source}); original.loadTopology(); original.selectionMode='face';
  const seedGroup=original.faceGroups.find(group => original.triangles[group.triangles[0]].materialIndex===1);
  original.selectedFaces.add(seedGroup.id); original.api.selectByMaterial(); assert.equal(original.selectedFaces.size,3);
  const buffer=await new GLTFExporter().parseAsync(source,{binary:true});
  const imported=await new GLTFLoader().parseAsync(buffer,'');
  // GLTFLoader keeps material primitives as separate meshes, each with local slot 0.
  const primitives=[]; imported.scene.traverse(object => { if(object.isMesh && object.material.color.r===1) primitives.push(object); });
  assert.equal(primitives.length,3);
  for (const mesh of primitives) {
    const edit=controller({edges:[],triangleToFaceGroup:[],mesh}); edit.loadTopology(); edit.selectionMode='face';
    edit.selectedFaces.add(edit.faceGroups[0].id); assert.equal(edit.api.selectByMaterial(),true);
    assert.equal(edit.selectedFaces.size,1);
    assert.ok(edit.faceGroups.every(group => group.triangles.every(index => edit.triangles[index].materialIndex===0)));
  }
});
