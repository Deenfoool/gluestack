import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Editor3D } from '../src/editor.js';
import { EditModeController } from '../src/edit/controller.js';
import { KnifeTool } from '../src/edit/knife-tool.js';
import { bindKeyboard } from '../src/keyboard.js';
import { installSelectionTools } from '../src/runtime/selection-tools.js';
import { installAdvancedEditSelection } from '../src/runtime/edit-selection-advanced.js';
import { installBoxSelect } from '../src/runtime/box-select.js';
import { installCircleSelect } from '../src/runtime/circle-select.js';
import { installVertexPicking } from '../src/runtime/vertex-picking.js';
import { createCleanExportRoot, exportCleanGlbBuffer } from '../src/runtime/export-clean.js';
import { ProjectController } from '../src/projects/controller.js';

function setup(geometry = new THREE.BoxGeometry(2,2,2)) {
  const dom = new JSDOM('<canvas id="viewport"></canvas>',{pretendToBeVisual:true,url:'https://example.test'});
  for (const key of ['window','document','FileReader','Blob','ProgressEvent','CustomEvent','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement']) globalThis[key]=dom.window[key];
  globalThis.requestAnimationFrame=()=>1; globalThis.cancelAnimationFrame=()=>{};
  const canvas=document.querySelector('canvas'); canvas.getBoundingClientRect=()=>({left:100,top:100,right:500,bottom:500,width:400,height:400});
  const editor=Object.create(Editor3D.prototype);
  const transform=new THREE.EventDispatcher(); transform.enabled=true; transform.attach=object=>{transform.object=object;}; transform.detach=()=>{transform.object=null;};
  Object.assign(editor,{
    scene:new THREE.Scene(), modelRoot:new THREE.Group(), selectedObjects:new Set(), selectionBoxes:[],
    renderer:{domElement:canvas,toneMappingExposure:1}, camera:new THREE.OrthographicCamera(-2,2,2,-2,.1,20), transform,
    raycaster:new THREE.Raycaster(), pointer:new THREE.Vector2(), orbit:{enabled:true,target:new THREE.Vector3()},
    undoStack:[],redoStack:[],pendingHistory:null,
    exporter:new GLTFExporter(),loader:new GLTFLoader(),
    events:{onSelection(){},onStructure(){},onTransform(){},onHistory(){},onStatus(message){editor.status=message;}},
    refreshSelectionVisuals(){},
  });
  editor.scene.add(editor.modelRoot); editor.camera.position.z=5; editor.camera.updateMatrixWorld();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({side:THREE.DoubleSide})); editor.modelRoot.add(mesh); editor.select(mesh);
  const edit=new EditModeController(editor); assert.equal(edit.enter(),true);
  const selection=installSelectionTools({editor,editMode:edit}), advanced=installAdvancedEditSelection({editMode:edit});
  const box=installBoxSelect({editor,editMode:edit}), circle=installCircleSelect({editor,editMode:edit});
  function pointer(target,type,x,y,options={}) {
    const event=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,...options}); Object.defineProperty(event,'pointerId',{value:1}); target.dispatchEvent(event);
  }
  function paintAll() {
    box.begin(); pointer(canvas,'pointerdown',100,100); pointer(window,'pointerup',500,500);
    circle.begin(); pointer(canvas,'pointerdown',300,300); pointer(window,'pointerup',300,300); circle.finish();
  }
  return {editor,mesh,edit,canvas,selection,advanced,box,circle,pointer,paintAll};
}

function isolateFace(edit) {
  edit.setSelectionMode('face'); const group=edit.faceGroups.find(group=>group.normal.z>.9);
  edit.selectedFaces.add(group.id); edit.visibility.hide(true); return group;
}

test('Hide Unselected face keeps shared borders and removes only viewport triangles',()=>{
  const {edit,mesh}=setup(); const geometry=mesh.geometry,material=mesh.material,index=[...geometry.index.array];
  const group=isolateFace(edit);
  assert.equal(edit.visibility.faces.size,5); assert.equal(edit.overlay.vertexIds.length,4); assert.equal(edit.overlay.edgeKeys.length,4);
  assert.equal(edit.selectionSurface().geometry.index.count,6); assert.equal(mesh.layers.mask,0);
  assert.deepEqual(mesh.geometry.index.array,geometry.index.array); assert.deepEqual([...mesh.geometry.index.array],index);
  assert.equal(mesh.geometry,geometry); assert.equal(mesh.material,material); assert.deepEqual(edit.selectedFaces,new Set([group.id]));
  assert.ok(edit.visibility.surfaceTriangles.every(id=>group.triangles.includes(id)));
});

test('Vertex and Edge isolation keeps selected loose components, mode switches preserve masks',()=>{
  for (const mode of ['vertex','edge']) {
    const {edit}=setup(); edit.setSelectionMode(mode);
    const key=mode==='vertex'?0:edit.logicalEdges[0].key; edit.currentSelectionSet().add(key); edit.visibility.hide(true);
    assert.deepEqual(edit.currentSelectionSet(),new Set([key]));
    assert.equal(mode==='vertex'?edit.overlay.vertexIds.length:edit.overlay.edgeKeys.length,1);
    assert.equal(edit.visibility.surface.geometry.index.count,0);
    const hidden=edit.visibility.faces.size; edit.setSelectionMode('face'); assert.equal(edit.visibility.faces.size,hidden);
    assert.equal(edit.visibility.reveal(),true); assert.equal(edit.overlay.vertexIds.length,8); assert.equal(edit.overlay.edgeKeys.length,12);
  }
});

test('All / Invert / Linked / Box / Circle / Material never reselect hidden components',()=>{
  const {edit,selection,advanced,paintAll}=setup(); const group=isolateFace(edit);
  for (const mode of ['vertex','edge','face']) {
    edit.setSelectionMode(mode); edit.selectAll(); const visible=new Set(edit.currentSelectionSet());
    selection.editInvert(); assert.equal(edit.selectedCount(),0); selection.editInvert(); assert.deepEqual(edit.currentSelectionSet(),visible);
    selection.editLinked(); assert.deepEqual(edit.currentSelectionSet(),visible);
    edit.deselectAll(); paintAll(); assert.deepEqual(edit.currentSelectionSet(),visible);
  }
  advanced.selectByMaterial(); assert.deepEqual(edit.selectedFaces,new Set([group.id]));
  const hiddenEdge=edit.logicalEdges.find(edge=>edit.visibility.edges.has(edge.key)); edit.setSelectionMode('edge'); edit.selectEdgeKey(hiddenEdge.key); assert.equal(edit.selectedEdges.size,0);
  const hiddenVertex=[...edit.visibility.vertices][0]; edit.setSelectionMode('vertex'); edit.selectComponent(hiddenVertex); assert.equal(edit.selectedVertices.size,0);
});

test('Raycast through hidden front face maps the proxy triangle to the visible back face, including Knife',()=>{
  const {edit,editor,canvas}=setup(); edit.setSelectionMode('face');
  const front=edit.faceGroups.find(group=>group.normal.z>.9); edit.selectedFaces.add(front.id); edit.visibility.hide();
  editor.raycaster.setFromCamera(new THREE.Vector2(0,0),editor.camera);
  const hit=editor.raycaster.intersectObject(edit.selectionSurface(),false)[0]; assert.ok(hit);
  const groupId=edit.triangleToFaceGroup[edit.triangleForHit(hit)]; assert.ok(edit.faceGroups[groupId].normal.z<-.9);
  editor.pointerStart={x:300,y:300}; edit.handlePointerUp({clientX:300,clientY:300,shiftKey:false}); assert.deepEqual(edit.selectedFaces,new Set([groupId]));
  const knife=new KnifeTool(editor,edit,()=>{}); const snap=knife.pointerHit({clientX:300,clientY:300,target:canvas}); assert.equal(snap.groupId,groupId);
});

test('Vertex pixel picking and overlay IDs skip hidden vertices without renumbering the topology',()=>{
  const {edit,editor}=setup(); edit.selectedVertices.add(0); edit.visibility.hide(true);
  assert.deepEqual(edit.overlay.vertexIds,[0]);
  const picker=installVertexPicking({editor,editMode:edit});
  const hidden=[...edit.visibility.vertices].find(id=>edit.vertices[id].position.x!==edit.vertices[0].position.x || edit.vertices[id].position.y!==edit.vertices[0].position.y);
  const p=edit.vertices[hidden].position.clone().project(editor.camera);
  assert.equal(picker.pick(300+p.x*200,300-p.y*200),null);
});

test('Hide All, repeated Reveal, and exit restore original layers and release proxy geometry only',()=>{
  const {edit,mesh,editor}=setup(); const original=mesh.geometry; let originalDisposals=0; original.addEventListener('dispose',()=>originalDisposals++);
  edit.setSelectionMode('face'); edit.selectAll(); edit.visibility.hide();
  const proxy=edit.visibility.surface; let proxyDisposals=0; proxy.geometry.addEventListener('dispose',()=>proxyDisposals++);
  assert.equal(proxy.geometry.index.count,0); assert.equal(edit.selectedCount(),0);
  assert.equal(edit.visibility.reveal(),true); assert.equal(proxyDisposals,1); assert.equal(mesh.layers.mask,1); assert.equal(originalDisposals,0);
  assert.equal(edit.visibility.reveal(),false);
  isolateFace(edit); edit.exit(); assert.equal(mesh.layers.mask,1); assert.equal(edit.visibility.hidden,false);
  assert.ok(!editor.scene.children.some(child=>child.name==='__gluestack_edit_surface')); assert.equal(originalDisposals,0);
});

test('Visibility proxy is reused for selection changes and rebuilt after geometry position updates',()=>{
  const {edit,mesh}=setup(); isolateFace(edit); const before=edit.visibility.surface.geometry;
  edit.refreshOverlay(); assert.equal(edit.visibility.surface.geometry,before);
  mesh.geometry.attributes.position.needsUpdate=true; edit.refreshOverlay(); assert.notEqual(edit.visibility.surface.geometry,before);
});

test('History and clean export clones contain original layers and full geometry while hidden',()=>{
  const {edit,mesh,editor}=setup(); isolateFace(edit);
  const state=editor.captureState(); assert.equal(state.root.children[0].layers.mask,1); assert.equal(state.root.children[0].geometry.index.count,36);
  const clean=createCleanExportRoot(editor); assert.equal(clean.children[0].layers.mask,1); assert.equal(clean.children[0].geometry.index.count,36);
  assert.equal(clean.children.length,1); assert.equal(mesh.layers.mask,0);
  editor.checkpoint('Edit after hiding'); edit.exit(); mesh.position.x=3; assert.equal(editor.undo(),true);
  assert.equal(editor.modelRoot.children[0].layers.mask,1); assert.equal(editor.modelRoot.children[0].position.x,0);
});

test('Real runtime GLB and binary .gluestack roundtrip retain full geometry/UV while hidden',async()=>{
  const {edit,editor,mesh}=setup(); isolateFace(edit);
  const project=Object.create(ProjectController.prototype); project.editor=editor;
  // Exercise the modifier project-root path as well as ordinary root cloning.
  let projectClones=0;
  editor.modifierStack={createProjectExportRoot(){projectClones++;return {root:editor.modelRoot.clone(true)};},disposeProjectExportRoot(){}};
  const parsedProject=project.decodeProject(await project.encodeProject());
  assert.equal(parsedProject.metadata.version,2); assert.equal(projectClones,1);
  assert.ok(!JSON.stringify(parsedProject.metadata).includes('hiddenFaces'));
  for (const buffer of [await exportCleanGlbBuffer(editor),parsedProject.glb]) {
    const parsed=await new GLTFLoader().parseAsync(buffer,''); let triangles=0,uvCount=0;
    parsed.scene.traverse(object=>{if(object.isMesh){triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;uvCount+=object.geometry.attributes.uv.count;}});
    assert.equal(triangles,12); assert.ok(uvCount>=24);
  }
  assert.equal(mesh.layers.mask,0); assert.equal(mesh.geometry.index.count,36); assert.equal(edit.visibility.hidden,true);
});

test('Topology regrouping retains hidden faces by triangle identity; geometry rebuild reveals safely',()=>{
  const {edit,mesh}=setup(); const group=isolateFace(edit); const hidden=new Set(edit.visibility.faces);
  edit.rebuildTopologyOnly(); edit.refreshOverlay(); assert.deepEqual(edit.visibility.faces,hidden); assert.equal(edit.visibility.surface.geometry.index.count,6);
  edit.rebuildMesh(edit.triangles); assert.equal(edit.visibility.hidden,false); assert.equal(mesh.layers.mask,1); assert.equal(mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count,36);
});

test('Hide/Reveal menu and H / Shift+H / Alt+H keyboard shortcuts route in Edit mode',()=>{
  const {edit,editor}=setup(); bindKeyboard({editor,editMode:edit,knifeTool:{active:false},transformModal:{state:null,handleKey:()=>false}});
  function key(options={}){window.dispatchEvent(new window.KeyboardEvent('keydown',{code:'KeyH',bubbles:true,cancelable:true,...options}));}
  edit.setSelectionMode('face'); edit.selectedFaces.add(0); key({shiftKey:true}); assert.equal(edit.visibility.faces.size,5);
  key({altKey:true}); assert.equal(edit.visibility.hidden,false);
  key(); assert.equal(edit.visibility.faces.size,1);
  const button=document.createElement('button'); button.dataset.action='edit-reveal';document.body.append(button);button.click();assert.equal(edit.visibility.hidden,false);
});


test('Multi-material hiding preserves source groups, materials, morph weights and child render layers',()=>{
  const {edit,mesh}=setup(); const materials=Array.from({length:6},(_,i)=>new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(i/6,1,.5)}));
  let materialDisposals=0; materials.forEach(material=>material.addEventListener('dispose',()=>materialDisposals++));
  mesh.material=materials; mesh.morphTargetInfluences=[.75];
  const child=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),materials[0]); mesh.add(child);
  const groups=structuredClone(mesh.geometry.groups); const group=isolateFace(edit);
  assert.deepEqual(mesh.geometry.groups,groups); assert.equal(child.layers.mask,1);
  assert.equal(edit.visibility.surface.material,materials); assert.deepEqual(edit.visibility.surface.morphTargetInfluences,[.75]);
  assert.equal(edit.visibility.surface.geometry.groups[0].materialIndex,edit.triangles[group.triangles[0]].materialIndex);
  assert.equal(edit.visibility.surface.geometry.groups.reduce((sum,group)=>sum+group.count,0),6);
  edit.visibility.reveal(); assert.equal(materialDisposals,0); assert.equal(mesh.layers.mask,1);
});

test('Hide refuses unsupported instanced geometry before changing viewport or masks',()=>{
  const {edit,mesh}=setup(); mesh.isInstancedMesh=true; edit.selectAll();
  assert.equal(edit.visibility.hide(),false); assert.equal(edit.visibility.hidden,false); assert.equal(mesh.layers.mask,1);
});


test('Loop/Ring stay on visible topology and reject manually supplied hidden seeds',()=>{
  const {edit,advanced}=setup(); isolateFace(edit); edit.setSelectionMode('edge');
  const visible=edit.logicalEdges.filter(edge=>!edit.visibility.edges.has(edge.key));
  edit.selectedEdges.add(visible[0].key); assert.equal(advanced.selectEdgeLoop(),true); assert.equal(edit.selectedEdges.size,4);
  assert.ok([...edit.selectedEdges].every(key=>!edit.visibility.edges.has(key)));
  edit.selectedEdges=new Set([visible[0].key]); assert.equal(advanced.selectEdgeRing(),true); assert.equal(edit.selectedEdges.size,2);
  const hidden=[...edit.visibility.edges][0]; edit.selectedEdges=new Set([hidden]);
  assert.equal(advanced.selectEdgeLoop(),false); assert.equal(advanced.selectEdgeRing(),false); assert.deepEqual(edit.selectedEdges,new Set([hidden]));
});
