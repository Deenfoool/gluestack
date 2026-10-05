import * as THREE from 'three';

// Render-only layer suppression must never enter history or exported scene clones.
const originalLayers = new WeakMap();
export function sourceLayerMask(object) { return originalLayers.get(object) ?? object.layers.mask; }
export function restoreSourceLayers(source, clone) {
  clone.layers.mask = sourceLayerMask(source);
  source.children.forEach((child, index) => { if (clone.children[index]) restoreSourceLayers(child, clone.children[index]); });
}

export function componentVisible(editMode, mode, key) {
  const visibility = editMode.visibility;
  if (!visibility) return true;
  return !(mode === 'vertex' ? visibility.vertices : mode === 'edge' ? visibility.edges : visibility.faces).has(key);
}

export class ComponentVisibility {
  constructor(controller) {
    this.controller = controller;
    this.vertices = new Set(); this.edges = new Set(); this.faces = new Set();
    this.surface = null; this.surfaceTriangles = [];
    this.revision = 0; this.surfaceStamp = null;
  }

  get hidden() { return this.vertices.size + this.edges.size + this.faces.size > 0; }

  restoreSurface() {
    const mesh = this.controller.mesh;
    if (mesh && originalLayers.has(mesh)) {
      mesh.layers.mask = originalLayers.get(mesh); originalLayers.delete(mesh);
    }
    if (this.surface) {
      this.surface.removeFromParent(); this.surface.geometry.dispose(); this.surface = null;
    }
    this.surfaceTriangles = []; this.surfaceStamp = null;
  }

  reset() {
    this.restoreSurface(); this.vertices.clear(); this.edges.clear(); this.faces.clear(); this.revision++;
  }

  hide(unselected = false) {
    const edit = this.controller;
    if (!edit.active) return false;
    if (edit.mesh?.isInstancedMesh || edit.mesh?.isBatchedMesh) { edit.status('Hide: инстансированные Mesh пока не поддерживаются'); return false; }
    const mode = edit.selectionMode, selected = edit.currentSelectionSet();
    const universe = mode === 'vertex' ? edit.vertices.map((_,id) => id) : mode === 'edge' ? edit.logicalEdges.map(edge => edge.key) : edit.faceGroups.map(group => group.id);
    const targets = universe.filter(key => componentVisible(edit,mode,key) && (unselected ? !selected.has(key) : selected.has(key)));
    if (!targets.length) { edit.status('Hide: нет компонентов для скрытия'); return false; }
    const hidden = mode === 'vertex' ? this.vertices : mode === 'edge' ? this.edges : this.faces;
    targets.forEach(key => hidden.add(key));
    // A hidden vertex/edge also hides its logical faces, including both triangles of a quad.
    for (const group of edit.faceGroups) {
      if (group.triangles.some(id => edit.triangles[id].v.some(vertex => this.vertices.has(vertex)))
        || group.boundary.some(edge => this.edges.has(edge.key))) this.faces.add(group.id);
    }
    if (mode === 'face') {
      const visibleVertices = new Set(), visibleEdges = new Set();
      for (const group of edit.faceGroups) {
        if (this.faces.has(group.id)) continue;
        for (const id of group.triangles) edit.triangles[id].v.forEach(vertex => visibleVertices.add(vertex));
        group.boundary.forEach(edge => visibleEdges.add(edge.key));
      }
      // Shared borders remain visible; loose vertices are unaffected by face hiding.
      const faceVertices = new Set(edit.triangles.flatMap(triangle => triangle.v));
      faceVertices.forEach(vertex => { if (!visibleVertices.has(vertex)) this.vertices.add(vertex); });
      edit.logicalEdges.forEach(edge => { if (!visibleEdges.has(edge.key)) this.edges.add(edge.key); });
    } else if (mode === 'vertex') {
      edit.logicalEdges.forEach(edge => { if (this.vertices.has(edge.a) || this.vertices.has(edge.b)) this.edges.add(edge.key); });
    } else {
      const surviving = new Set();
      edit.logicalEdges.forEach(edge => { if (!this.edges.has(edge.key)) { surviving.add(edge.a); surviving.add(edge.b); } });
      const edgeVertices = new Set(edit.logicalEdges.flatMap(edge => [edge.a,edge.b]));
      edgeVertices.forEach(vertex => { if (!surviving.has(vertex)) this.vertices.add(vertex); });
    }
    this.revision++;
    this.pruneSelection(); edit.refreshOverlay(); edit.updatePivot(); edit.emitChange();
    edit.status(`Hide ${unselected ? 'Unselected' : 'Selected'} · ${targets.length} ${mode}(s) · Alt+H показать всё`);
    return true;
  }

  pruneSelection() {
    const edit = this.controller;
    for (const [mode, set] of [['vertex',edit.selectedVertices],['edge',edit.selectedEdges],['face',edit.selectedFaces]]) {
      for (const key of set) if (!componentVisible(edit,mode,key)) set.delete(key);
    }
  }

  reveal() {
    if (!this.controller.active || !this.hidden) return false;
    this.reset(); const edit = this.controller;
    edit.refreshOverlay(); edit.updatePivot(); edit.emitChange(); edit.status('Reveal All · Edit components');
    return true;
  }

  remapFaces(previousGroups) {
    const triangles = new Set();
    for (const group of previousGroups) if (this.faces.has(group.id)) group.triangles.forEach(id => triangles.add(id));
    this.faces.clear();
    for (const group of this.controller.faceGroups) if (group.triangles.some(id => triangles.has(id))) this.faces.add(group.id);
    this.revision++; this.pruneSelection();
  }

  refreshSurface() {
    const edit = this.controller, mesh = edit.mesh;
    if (!this.hidden || !mesh) { this.restoreSurface(); return; }
    if (!originalLayers.has(mesh)) originalLayers.set(mesh, mesh.layers.mask);
    mesh.layers.mask = 0;
    const stamp = `${mesh.geometry.uuid}|${this.revision}|${Object.values(mesh.geometry.attributes).map(attribute => attribute.version).join(',')}`;
    if (this.surfaceStamp === stamp && this.surface) { this.syncSurface(); return; }
    const geometry = mesh.geometry.clone(), sourceIndex = mesh.geometry.index;
    const count = sourceIndex ? sourceIndex.count : geometry.getAttribute('position').count;
    const indices = [], triangles = []; geometry.clearGroups();
    let lastMaterial = null;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const triangle = edit.sourceFaceToTriangle[offset / 3];
      if (triangle === undefined || triangle < 0 || this.faces.has(edit.triangleToFaceGroup[triangle])) continue;
      const material = edit.triangles[triangle]?.materialIndex ?? 0;
      if (lastMaterial !== material) { geometry.addGroup(indices.length,0,material); lastMaterial = material; }
      geometry.groups.at(-1).count += 3;
      for (let side = 0; side < 3; side++) indices.push(sourceIndex ? sourceIndex.getX(offset+side) : offset+side);
      triangles.push(triangle);
    }
    geometry.setIndex(indices); geometry.setDrawRange(0,indices.length);
    if (!this.surface) {
      this.surface = new THREE.Mesh(geometry,mesh.material);
      this.surface.name = '__gluestack_edit_surface'; this.surface.matrixAutoUpdate = false;
      edit.editor.scene.add(this.surface);
    } else { this.surface.geometry.dispose(); this.surface.geometry = geometry; this.surface.material = mesh.material; }
    this.surfaceTriangles = triangles; this.surfaceStamp = stamp; this.syncSurface();
  }

  syncSurface() {
    const mesh = this.controller.mesh;
    mesh.updateWorldMatrix(true,false); this.surface.matrix.copy(mesh.matrixWorld); this.surface.updateMatrixWorld(true);
    this.surface.layers.mask = sourceLayerMask(mesh);
    this.surface.renderOrder = mesh.renderOrder; this.surface.frustumCulled = mesh.frustumCulled;
    this.surface.castShadow = mesh.castShadow; this.surface.receiveShadow = mesh.receiveShadow;
    this.surface.visible = true;
    for (let object = mesh; object; object = object.parent) if (!object.visible) this.surface.visible = false;
    this.surface.material = mesh.material;
    if (mesh.morphTargetInfluences) this.surface.morphTargetInfluences = mesh.morphTargetInfluences;
  }
}
