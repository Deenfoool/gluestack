import * as THREE from 'three';
import { EditOverlay } from './overlay.js';
import {
  buildTopology,
  readMeshTopology,
  rebuildMeshGeometry,
  syncLogicalPositions,
} from './topology.js';
import {
  deleteSelection,
  extrude,
  fillSelected,
  flipNormals,
  inset,
  mergeSelected,
  recalculateNormals,
} from './operations.js';

function logicalEdges(edges, triangleToFaceGroup) {
  return edges.filter((edge) => {
    if (!edge?.triangles?.length) return false;
    if (edge.triangles.length !== 2) return true;
    const [a, b] = edge.triangles;
    return triangleToFaceGroup?.[a] !== triangleToFaceGroup?.[b];
  });
}

export class EditModeController {
  constructor(editor, events = {}) {
    this.editor = editor;
    this.events = {
      onChange: events.onChange ?? (() => {}),
      onStatus: events.onStatus ?? ((message) => editor.events.onStatus(message)),
    };
    this.active = false;
    this.mesh = null;
    this.selectionMode = 'vertex';
    this.vertices = [];
    this.triangles = [];
    this.edges = [];
    this.logicalEdges = [];
    this.faceGroups = [];
    this.triangleToFaceGroup = [];
    this.sourceFaceToTriangle = [];
    this.selectedVertices = new Set();
    this.selectedEdges = new Set();
    this.selectedFaces = new Set();
    this.overlay = new EditOverlay(editor);
    this.pivot = new THREE.Object3D();
    this.pivot.name = '__gluestack_edit_pivot';
    this.transformStart = null;

    editor.transform.addEventListener('mouseDown', () => {
      if (this.active && editor.transform.object === this.pivot) this.beginPivotTransform();
    });
    editor.transform.addEventListener('objectChange', () => {
      if (this.active && editor.transform.object === this.pivot) this.applyPivotTransform();
    });
    editor.transform.addEventListener('mouseUp', () => {
      if (this.active && this.transformStart) this.finishPivotTransform();
    });
  }

  status(message) {
    this.events.onStatus(message);
  }

  enter(mesh = this.editor.selected) {
    if (this.active) return true;
    if (!mesh?.isMesh || mesh.isSkinnedMesh || !mesh.geometry?.getAttribute('position')) {
      this.status('Edit Mode: выберите обычный Mesh');
      return false;
    }

    this.active = true;
    this.mesh = mesh;
    this.editor.select(mesh);
    this.clearObjectSelectionVisuals();
    this.loadTopology();
    this.editor.scene.add(this.pivot);
    this.overlay.mount(mesh);
    this.refreshOverlay();
    this.updatePivot();
    this.status(`Edit Mode · ${mesh.name || 'Mesh'} · Vertex Select`);
    this.emitChange();
    return true;
  }

  exit() {
    if (!this.active) return false;
    const mesh = this.mesh;
    this.overlay.dispose();
    this.editor.transform.detach();
    this.editor.scene.remove(this.pivot);
    this.transformStart = null;
    this.active = false;
    this.mesh = null;
    this.clearComponentSelection();
    if (mesh?.parent) this.editor.select(mesh);
    else this.editor.clearSelection();
    this.status('Object Mode');
    this.emitChange();
    return true;
  }

  toggle() {
    return this.active ? this.exit() : this.enter();
  }

  clearObjectSelectionVisuals() {
    this.editor.transform.detach();
    for (const box of this.editor.selectionBoxes) {
      this.editor.scene.remove(box);
      box.geometry.dispose();
      box.material.dispose();
    }
    this.editor.selectionBoxes.length = 0;
  }

  updateLogicalEdges() {
    this.logicalEdges = logicalEdges(this.edges, this.triangleToFaceGroup);
  }

  loadTopology() {
    Object.assign(this, readMeshTopology(this.mesh));
    this.updateLogicalEdges();
  }

  rebuildTopologyOnly() {
    Object.assign(this, buildTopology(this.vertices, this.triangles));
    this.updateLogicalEdges();
  }

  handlePointerUp(event) {
    if (!this.active || !this.editor.pointerStart || this.editor.transform.dragging) return;
    const dx = event.clientX - this.editor.pointerStart.x;
    const dy = event.clientY - this.editor.pointerStart.y;
    this.editor.pointerStart = null;
    if (Math.hypot(dx, dy) > 4 || this.editor.transform.axis) return;

    const rect = this.editor.renderer.domElement.getBoundingClientRect();
    this.editor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.editor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.editor.raycaster.setFromCamera(this.editor.pointer, this.editor.camera);
    const additive = event.shiftKey;

    if (this.selectionMode === 'vertex') {
      this.editor.raycaster.params.Points.threshold = 0.14;
      const hit = this.editor.raycaster.intersectObject(this.overlay.points, false)[0];
      this.selectComponent(hit ? hit.index : null, additive);
      return;
    }
    if (this.selectionMode === 'edge') {
      this.editor.raycaster.params.Line.threshold = 0.08;
      const hit = this.editor.raycaster.intersectObject(this.overlay.lines, false)[0];
      const visibleIndex = hit ? Math.floor((hit.index ?? 0) / 2) : -1;
      const key = visibleIndex >= 0 ? this.overlay.edgeKeys[visibleIndex] : null;
      this.selectEdgeKey(key, additive);
      return;
    }

    const hit = this.editor.raycaster.intersectObject(this.mesh, false)[0];
    const internalTriangle = hit ? this.sourceFaceToTriangle[hit.faceIndex] : -1;
    const faceGroup = internalTriangle >= 0 ? this.triangleToFaceGroup[internalTriangle] : null;
    this.selectComponent(faceGroup >= 0 ? faceGroup : null, additive);
  }

  selectEdgeKey(key, additive = false) {
    const set = this.selectedEdges;
    if (!additive) set.clear();
    if (key !== null && key !== undefined) {
      if (additive && set.has(key)) set.delete(key);
      else set.add(key);
    }
    this.refreshOverlay();
    this.updatePivot();
    this.emitChange();
  }

  selectComponent(index, additive = false) {
    const set = this.currentSelectionSet();
    if (!additive) set.clear();
    if (index !== null && index !== undefined) {
      const key = this.selectionMode === 'edge' ? this.logicalEdges[index]?.key : index;
      if (key !== undefined) {
        if (additive && set.has(key)) set.delete(key);
        else set.add(key);
      }
    }
    this.refreshOverlay();
    this.updatePivot();
    this.emitChange();
  }

  currentSelectionSet() {
    if (this.selectionMode === 'edge') return this.selectedEdges;
    if (this.selectionMode === 'face') return this.selectedFaces;
    return this.selectedVertices;
  }

  setSelectionMode(mode) {
    if (!['vertex', 'edge', 'face'].includes(mode) || mode === this.selectionMode) return;
    this.selectionMode = mode;
    this.clearComponentSelection();
    this.refreshOverlay();
    this.updatePivot();
    this.status(`${mode[0].toUpperCase()}${mode.slice(1)} Select`);
    this.emitChange();
  }

  clearComponentSelection() {
    this.selectedVertices.clear();
    this.selectedEdges.clear();
    this.selectedFaces.clear();
  }

  selectAll() {
    const set = this.currentSelectionSet();
    set.clear();
    if (this.selectionMode === 'vertex') this.vertices.forEach((_, index) => set.add(index));
    else if (this.selectionMode === 'edge') this.logicalEdges.forEach((edge) => set.add(edge.key));
    else this.faceGroups.forEach((group) => set.add(group.id));
    this.refreshOverlay();
    this.updatePivot();
    this.emitChange();
  }

  deselectAll() {
    this.clearComponentSelection();
    this.refreshOverlay();
    this.updatePivot();
    this.emitChange();
  }

  getSelectedVertexIds() {
    if (this.selectionMode === 'vertex') return new Set(this.selectedVertices);
    if (this.selectionMode === 'edge') {
      const result = new Set();
      for (const edge of this.logicalEdges) {
        if (!this.selectedEdges.has(edge.key)) continue;
        result.add(edge.a);
        result.add(edge.b);
      }
      return result;
    }
    const result = new Set();
    for (const triangleIndex of this.getSelectedTriangleIds()) {
      this.triangles[triangleIndex].v.forEach((vertexId) => result.add(vertexId));
    }
    return result;
  }

  getSelectedTriangleIds() {
    const result = new Set();
    if (this.selectionMode !== 'face') return result;
    for (const groupId of this.selectedFaces) {
      this.faceGroups[groupId]?.triangles.forEach((triangleIndex) => result.add(triangleIndex));
    }
    return result;
  }

  selectedCount() {
    return this.currentSelectionSet().size;
  }

  refreshOverlay() {
    if (!this.active) return;
    this.overlay.refresh({
      vertices: this.vertices,
      edges: this.logicalEdges,
      triangles: this.triangles,
      triangleToFaceGroup: this.triangleToFaceGroup,
      selectionMode: this.selectionMode,
      selectedVertices: this.getSelectedVertexIds(),
      selectedEdges: this.selectedEdges,
      selectedTriangles: this.getSelectedTriangleIds(),
    });
  }

  updatePivot() {
    if (!this.active) return;
    const selected = this.getSelectedVertexIds();
    if (!selected.size) {
      this.editor.transform.detach();
      return;
    }
    const center = new THREE.Vector3();
    for (const vertexId of selected) center.add(this.vertices[vertexId].position);
    center.multiplyScalar(1 / selected.size);
    this.mesh.updateWorldMatrix(true, false);
    this.pivot.position.copy(center.applyMatrix4(this.mesh.matrixWorld));
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    this.editor.transform.attach(this.pivot);
  }

  captureSelectedPositions() {
    return [...this.getSelectedVertexIds()].map((id) => ({ id, position: this.vertices[id].position.clone() }));
  }

  restoreSelectedPositions(snapshot) {
    for (const item of snapshot) {
      if (this.vertices[item.id]) this.vertices[item.id].position.copy(item.position);
    }
    syncLogicalPositions(this.mesh, this.vertices);
    this.refreshOverlay();
    this.updatePivot();
  }

  applyNumericTransform(snapshot, mode, axis, value) {
    if (!snapshot.length) return;
    const center = new THREE.Vector3();
    snapshot.forEach((item) => center.add(item.position));
    center.multiplyScalar(1 / snapshot.length);

    for (const item of snapshot) {
      const vertex = this.vertices[item.id];
      if (!vertex) continue;
      const next = item.position.clone();
      if (mode === 'translate') next[axis] += value;
      else if (mode === 'scale') {
        next.sub(center);
        if (axis) next[axis] *= value;
        else next.multiplyScalar(value);
        next.add(center);
      } else if (mode === 'rotate') {
        next.sub(center).applyEuler(new THREE.Euler(
          axis === 'x' ? THREE.MathUtils.degToRad(value) : 0,
          axis === 'y' ? THREE.MathUtils.degToRad(value) : 0,
          axis === 'z' ? THREE.MathUtils.degToRad(value) : 0,
        )).add(center);
      }
      vertex.position.copy(next);
    }
    syncLogicalPositions(this.mesh, this.vertices);
    this.refreshOverlay();
    this.updatePivot();
  }

  beginPivotTransform() {
    const snapshot = this.captureSelectedPositions();
    if (!snapshot.length) return;
    this.pivot.updateMatrixWorld(true);
    this.mesh.updateWorldMatrix(true, false);
    this.transformStart = {
      snapshot,
      pivotMatrix: this.pivot.matrixWorld.clone(),
      meshMatrix: this.mesh.matrixWorld.clone(),
      meshMatrixInverse: this.mesh.matrixWorld.clone().invert(),
    };
  }

  applyPivotTransform() {
    if (!this.transformStart) return;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.transformStart.pivotMatrix.clone().invert());
    for (const item of this.transformStart.snapshot) {
      const vertex = this.vertices[item.id];
      if (!vertex) continue;
      vertex.position.copy(item.position)
        .applyMatrix4(this.transformStart.meshMatrix)
        .applyMatrix4(delta)
        .applyMatrix4(this.transformStart.meshMatrixInverse);
    }
    syncLogicalPositions(this.mesh, this.vertices);
    this.refreshOverlay();
  }

  finishPivotTransform() {
    this.transformStart = null;
    this.rebuildTopologyOnly();
    this.refreshOverlay();
    this.updatePivot();
    this.emitChange();
  }

  rebuildMesh(triangles) {
    rebuildMeshGeometry(this.mesh, this.vertices, triangles);
    this.clearComponentSelection();
    this.loadTopology();
    this.overlay.mount(this.mesh);
    this.refreshOverlay();
    this.updatePivot();
    this.editor.events.onStructure();
    this.emitChange();
  }

  deleteSelection() { return deleteSelection(this); }
  extrude(distance) { return extrude(this, distance); }
  inset(factor) { return inset(this, factor); }
  mergeSelected() { return mergeSelected(this); }
  fillSelected() { return fillSelected(this); }
  recalculateNormals() { return recalculateNormals(this); }
  flipNormals() { return flipNormals(this); }

  emitChange() {
    this.events.onChange({
      active: this.active,
      mesh: this.mesh,
      selectionMode: this.selectionMode,
      selectedCount: this.selectedCount(),
      vertexCount: this.vertices.length,
      edgeCount: this.logicalEdges.length,
      faceCount: this.faceGroups.length,
    });
  }
}
