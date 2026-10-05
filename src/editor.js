import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = THREE.MathUtils.RAD2DEG;
const HISTORY_LIMIT = 24;

export class Editor3D {
  constructor(container, events = {}) {
    this.container = container;
    this.events = {
      onSelection: events.onSelection ?? (() => {}),
      onStructure: events.onStructure ?? (() => {}),
      onTransform: events.onTransform ?? (() => {}),
      onHistory: events.onHistory ?? (() => {}),
      onStatus: events.onStatus ?? (() => {}),
    };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x393939);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
    this.camera.position.set(6, 4.5, 7);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.tabIndex = 0;
    this.container.appendChild(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode('translate');
    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
    });
    this.transform.addEventListener('mouseDown', () => this.beginHistory('Transform'));
    this.transform.addEventListener('mouseUp', () => this.commitHistory());
    this.transform.addEventListener('objectChange', () => {
      this.updateSelectionBoxes();
      this.events.onTransform(this.selected);
    });
    this.scene.add(this.transform.getHelper());

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Scene Collection';
    this.modelRoot.userData.gluestackRoot = true;
    this.scene.add(this.modelRoot);

    this.grid = new THREE.GridHelper(40, 40, 0x5a5a5a, 0x474747);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.85;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(1.25);
    this.scene.add(this.axes);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 1.8);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(5, 8, 5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xa9c9ff, 0.8);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerStart = null;
    this.selected = null;
    this.selectedObjects = new Set();
    this.selectionBoxes = [];
    this.loader = new GLTFLoader();
    this.exporter = new GLTFExporter();
    this.undoStack = [];
    this.redoStack = [];
    this.pendingHistory = null;
    this.snapEnabled = false;

    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', (event) => this.handlePointerUp(event));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    this.newScene({ record: false });
    this.animate();
    this.emitHistory();
  }

  animate = () => {
    this.animationFrame = requestAnimationFrame(this.animate);
    // The full-size canvas is hidden behind Home. Rendering it still consumes
    // GPU time and updates every selection box even though no frame is visible.
    if (document.hidden || document.body.classList.contains('gluestack-home-open')) return;
    this.orbit.update();
    this.updateSelectionBoxes();
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  handlePointerUp(event) {
    if (!this.pointerStart || this.transform.dragging) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    this.pointerStart = null;
    if (Math.hypot(dx, dy) > 4 || this.transform.axis) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshes = [];
    this.modelRoot.traverse((object) => {
      if (object.isMesh && object.visible) meshes.push(object);
    });

    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    this.select(hit?.object ?? null, event.shiftKey);
  }

  newScene({ record = true } = {}) {
    if (record) this.checkpoint('New scene');
    this.clearSelection();
    for (const child of [...this.modelRoot.children]) {
      this.modelRoot.remove(child);
      this.disposeObjectResources(child);
    }
    this.addPrimitive('cube', { record: false });
    this.events.onStatus('Новая сцена создана');
    this.events.onStructure();
  }

  makeMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xb8b8b8,
      metalness: 0,
      roughness: 0.58,
      side: THREE.FrontSide,
    });
  }

  addPrimitive(type, { record = true } = {}) {
    if (record) this.checkpoint(`Add ${type}`);
    let geometry;
    let baseName;

    switch (type) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(1, 32, 20);
        baseName = 'Sphere';
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(1, 1, 2, 32, 1, false);
        baseName = 'Cylinder';
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(1, 2, 32, 1, false);
        baseName = 'Cone';
        break;
      case 'plane':
        geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
        baseName = 'Plane';
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(1, 0.3, 16, 48);
        baseName = 'Torus';
        break;
      case 'cube':
      default:
        geometry = new THREE.BoxGeometry(2, 2, 2);
        baseName = 'Cube';
        break;
    }

    const material = this.makeMaterial();
    if (type === 'plane') material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = this.uniqueName(baseName);
    mesh.userData.gluestackGenerated = true;
    this.assignIds(mesh, true);
    this.modelRoot.add(mesh);
    this.select(mesh);
    this.events.onStructure();
    this.events.onStatus(`${mesh.name} добавлен`);
    return mesh;
  }

  createCollection() {
    this.checkpoint('Create collection');
    const collection = new THREE.Group();
    collection.name = this.uniqueName('Collection');
    collection.userData.gluestackCollection = true;
    this.assignIds(collection, true);
    this.modelRoot.add(collection);

    const moving = this.getTopLevelSelection();
    for (const object of moving) {
      if (object === collection || this.isAncestorOf(object, collection)) continue;
      collection.attach(object);
    }

    this.select(collection);
    this.events.onStructure();
    this.events.onStatus(`${collection.name} создана`);
    return collection;
  }

  uniqueName(baseName) {
    const names = new Set();
    this.modelRoot.traverse((object) => {
      if (object.name) names.add(object.name);
    });
    if (!names.has(baseName)) return baseName;

    let index = 1;
    let candidate;
    do {
      candidate = `${baseName}.${String(index).padStart(3, '0')}`;
      index += 1;
    } while (names.has(candidate));
    return candidate;
  }

  assignIds(root, force = false) {
    root.traverse((object) => {
      if (force || !object.userData.gluestackId) object.userData.gluestackId = crypto.randomUUID();
    });
  }

  select(object, additive = false) {
    if (object === this.modelRoot) object = null;

    if (!additive) this.selectedObjects.clear();

    if (object) {
      this.assignIds(object);
      if (additive && this.selectedObjects.has(object)) {
        this.selectedObjects.delete(object);
        if (this.selected === object) this.selected = [...this.selectedObjects].at(-1) ?? null;
      } else {
        this.selectedObjects.add(object);
        this.selected = object;
      }
    } else if (!additive) {
      this.selected = null;
    }

    if (!this.selectedObjects.size) this.selected = null;
    this.refreshSelectionVisuals();
    this.events.onSelection(this.selected, this.getSelectedObjects());
  }

  selectMany(objects, active = objects.at(-1) ?? null) {
    this.selectedObjects.clear();
    for (const object of objects) {
      if (!object || object === this.modelRoot) continue;
      this.assignIds(object);
      this.selectedObjects.add(object);
    }
    this.selected = active && this.selectedObjects.has(active) ? active : [...this.selectedObjects].at(-1) ?? null;
    this.refreshSelectionVisuals();
    this.events.onSelection(this.selected, this.getSelectedObjects());
  }

  clearSelection() {
    this.selectedObjects.clear();
    this.selected = null;
    this.refreshSelectionVisuals();
    this.events.onSelection(null, []);
  }

  isSelected(object) {
    return this.selectedObjects.has(object);
  }

  getSelectedObjects() {
    return [...this.selectedObjects];
  }

  refreshSelectionVisuals() {
    this.transform.detach();
    for (const box of this.selectionBoxes) {
      this.scene.remove(box);
      box.geometry.dispose();
      box.material.dispose();
    }
    this.selectionBoxes.length = 0;

    for (const object of this.selectedObjects) {
      const box = new THREE.BoxHelper(object, object === this.selected ? 0xff9500 : 0xd6a15a);
      this.scene.add(box);
      this.selectionBoxes.push(box);
    }

    if (this.selected) this.transform.attach(this.selected);
  }

  updateSelectionBoxes() {
    for (const box of this.selectionBoxes) box.update();
  }

  setTransformMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.transform.setMode(mode);
  }

  setSnapEnabled(enabled) {
    this.snapEnabled = Boolean(enabled);
    this.transform.setTranslationSnap(this.snapEnabled ? 1 : null);
    this.transform.setRotationSnap(this.snapEnabled ? THREE.MathUtils.degToRad(15) : null);
    this.transform.setScaleSnap(this.snapEnabled ? 0.1 : null);
    this.events.onStatus(this.snapEnabled ? 'Snap включён · 1u / 15° / 0.1' : 'Snap выключен');
  }

  deleteSelected() {
    const objects = this.getTopLevelSelection();
    if (!objects.length) return;
    this.checkpoint('Delete');
    const label = objects.length === 1 ? objects[0].name || 'Object' : `${objects.length} objects`;
    this.clearSelection();
    for (const object of objects) {
      object.parent?.remove(object);
      this.disposeObjectResources(object);
    }
    this.events.onStructure();
    this.events.onStatus(`${label} удалено`);
  }

  duplicateSelected() {
    const sources = this.getTopLevelSelection();
    if (!sources.length) return [];
    this.checkpoint('Duplicate');
    const clones = [];

    for (const source of sources) {
      const clone = this.cloneObjectDeep(source);
      clone.name = this.uniqueName(source.name || source.type || 'Object');
      this.assignIds(clone, true);
      source.parent?.add(clone);
      clone.position.copy(source.position);
      clone.quaternion.copy(source.quaternion);
      clone.scale.copy(source.scale);
      clones.push(clone);
    }

    this.selectMany(clones, clones.at(-1));
    this.events.onStructure();
    this.events.onStatus(`${clones.length} объект(ов) дублировано`);
    return clones;
  }

  parentSelected() {
    const parent = this.selected;
    const selected = this.getSelectedObjects();
    if (!parent || selected.length < 2) {
      this.events.onStatus('Parent: выделите минимум 2 объекта, активный станет родителем');
      return false;
    }

    const children = selected.filter((object) => object !== parent && !this.isAncestorOf(object, parent));
    if (!children.length) return false;

    this.checkpoint('Parent');
    for (const child of children) parent.attach(child);
    this.select(parent);
    this.events.onStructure();
    this.events.onStatus(`${children.length} объект(ов) привязано к ${parent.name}`);
    return true;
  }

  clearParent() {
    const objects = this.getTopLevelSelection().filter((object) => object.parent && object.parent !== this.modelRoot);
    if (!objects.length) {
      this.events.onStatus('У выделенных объектов нет родителя');
      return false;
    }

    this.checkpoint('Clear parent');
    for (const object of objects) this.modelRoot.attach(object);
    this.selectMany(objects, objects.at(-1));
    this.events.onStructure();
    this.events.onStatus(`Parent очищен у ${objects.length} объект(ов)`);
    return true;
  }

  joinSelected() {
    const meshes = this.getTopLevelSelection().filter((object) => object.isMesh && !object.isSkinnedMesh);
    if (meshes.length < 2 || !this.selected?.isMesh || !meshes.includes(this.selected)) {
      this.events.onStatus('Join: выделите минимум 2 Mesh, активный объект должен быть Mesh');
      return false;
    }
    if (meshes.some((mesh) => Array.isArray(mesh.material) || mesh.morphTargetInfluences?.length)) {
      this.events.onStatus('Join пока поддерживает обычные Mesh с одним материалом');
      return false;
    }

    const geometries = [];
    const materials = [];
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      let geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (!geometry.getAttribute('uv')) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
      }
      for (const attributeName of Object.keys(geometry.attributes)) {
        if (!['position', 'normal', 'uv'].includes(attributeName)) geometry.deleteAttribute(attributeName);
      }
      geometry.applyMatrix4(mesh.matrixWorld);
      geometries.push(geometry);
      materials.push(mesh.material.clone());
    }

    const merged = mergeGeometries(geometries, true);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) {
      materials.forEach((material) => material.dispose());
      this.events.onStatus('Join не выполнен: несовместимая геометрия');
      return false;
    }

    this.checkpoint('Join');
    const activeName = this.selected.name || 'Joined';
    for (const mesh of meshes) {
      mesh.parent?.remove(mesh);
      this.disposeObjectResources(mesh);
    }

    const joined = new THREE.Mesh(merged, materials);
    joined.name = activeName;
    joined.userData.gluestackGenerated = true;
    this.assignIds(joined, true);
    this.modelRoot.add(joined);
    this.select(joined);
    this.events.onStructure();
    this.events.onStatus(`${meshes.length} Mesh объединены`);
    return true;
  }

  separateSelected() {
    const group = this.selected;
    if (!group || group.isMesh || group === this.modelRoot || group.children.length < 1) {
      this.events.onStatus('Separate: выберите Group/Collection с дочерними объектами');
      return false;
    }

    this.checkpoint('Separate');
    const parent = group.parent ?? this.modelRoot;
    const children = [...group.children];
    for (const child of children) parent.attach(child);
    parent.remove(group);
    this.selectMany(children, children.at(-1));
    this.events.onStructure();
    this.events.onStatus(`${group.name || 'Group'} разделён`);
    return true;
  }

  applyTransform() {
    const meshes = this.getSelectedObjects().filter((object) => object.isMesh && !object.isSkinnedMesh && object.children.length === 0);
    if (!meshes.length) {
      this.events.onStatus('Apply Transform: выберите обычный Mesh без дочерних объектов');
      return false;
    }

    this.checkpoint('Apply transform');
    for (const mesh of meshes) {
      mesh.updateMatrix();
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.updateMatrix();
    }
    this.refreshSelectionVisuals();
    this.events.onTransform(this.selected);
    this.events.onStatus(`Transform применён к ${meshes.length} Mesh`);
    return true;
  }

  originToGeometry() {
    const meshes = this.getSelectedObjects().filter((object) => object.isMesh && !object.isSkinnedMesh);
    if (!meshes.length) {
      this.events.onStatus('Origin: выберите Mesh');
      return false;
    }

    this.checkpoint('Origin to geometry');
    for (const mesh of meshes) {
      const geometry = mesh.geometry.clone();
      geometry.computeBoundingBox();
      if (!geometry.boundingBox) continue;
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      const offset = center.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion);
      mesh.position.add(offset);
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.updateMatrix();
    }
    this.refreshSelectionVisuals();
    this.events.onTransform(this.selected);
    this.events.onStatus(`Origin центрирован у ${meshes.length} Mesh`);
    return true;
  }

  disposeObjectResources(object) {
    object.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
      else child.material?.dispose?.();
    });
  }

  cloneObjectDeep(source) {
    const clone = source.clone(false);
    clone.clear();
    if (source.geometry) clone.geometry = source.geometry.clone();
    if (source.material) {
      clone.material = Array.isArray(source.material)
        ? source.material.map((material) => material.clone())
        : source.material.clone();
    }
    for (const child of source.children) clone.add(this.cloneObjectDeep(child));
    return clone;
  }

  renameSelected(name) {
    if (!this.selected) return;
    const cleaned = name.trim();
    if (!cleaned || cleaned === this.selected.name) return;
    this.checkpoint('Rename');
    this.selected.name = cleaned;
    this.events.onStructure();
  }

  setTransformValue(path, value) {
    if (!this.selected || !Number.isFinite(value)) return;
    const [group, axis] = path.split('.');
    if (!this.selected[group] || !['x', 'y', 'z'].includes(axis)) return;
    this.selected[group][axis] = value;
    this.selected.updateMatrix();
    this.updateSelectionBoxes();
    this.events.onTransform(this.selected);
  }

  setVisible(object, visible) {
    if (!object || object === this.modelRoot || object.visible === visible) return;
    this.checkpoint(visible ? 'Show object' : 'Hide object');
    object.visible = visible;
    if (this.selectedObjects.has(object) && !visible) this.select(object, true);
    this.events.onStructure();
  }

  async importFile(file) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
      throw new Error('Поддерживаются только .glb и .gltf');
    }

    this.events.onStatus(`Импорт: ${file.name}…`);
    const payload = lower.endsWith('.glb') ? await file.arrayBuffer() : await file.text();

    return new Promise((resolve, reject) => {
      this.loader.parse(
        payload,
        '',
        (gltf) => {
          this.checkpoint('Import');
          const imported = gltf.scene;
          imported.name = imported.name || file.name.replace(/\.(glb|gltf)$/i, '');
          this.assignIds(imported, true);
          this.modelRoot.add(imported);
          this.select(imported);
          this.events.onStructure();
          this.events.onStatus(`${file.name} импортирован`);
          resolve(imported);
        },
        (error) => reject(error instanceof Error ? error : new Error(String(error))),
      );
    });
  }

  async exportGlb(filename = 'model.glb') {
    if (this.modelRoot.children.length === 0) throw new Error('Сцена пуста');
    this.events.onStatus('Экспорт GLB…');

    const data = await new Promise((resolve, reject) => {
      this.exporter.parse(
        this.modelRoot,
        resolve,
        reject,
        {
          binary: true,
          onlyVisible: false,
          trs: false,
          maxTextureSize: 4096,
        },
      );
    });

    const blob = new Blob([data], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.events.onStatus(`${filename} экспортирован`);
  }

  getObjects() {
    const objects = [];
    const walk = (parent, depth) => {
      for (const child of parent.children) {
        objects.push({ object: child, depth });
        if (child.children.length) walk(child, depth + 1);
      }
    };
    walk(this.modelRoot, 0);
    return objects;
  }

  getStats() {
    let objects = 0;
    let vertices = 0;
    let triangles = 0;

    this.modelRoot.traverse((object) => {
      if (object === this.modelRoot) return;
      objects += 1;
      if (!object.isMesh || !object.geometry) return;
      const position = object.geometry.getAttribute('position');
      if (!position) return;
      vertices += position.count;
      triangles += object.geometry.index ? object.geometry.index.count / 3 : position.count / 3;
    });

    return {
      objects,
      vertices: Math.round(vertices),
      triangles: Math.round(triangles),
    };
  }

  frameSelected() {
    if (!this.selectedObjects.size) return this.frameAll();
    const group = new THREE.Box3();
    for (const object of this.selectedObjects) group.union(new THREE.Box3().setFromObject(object));
    this.frameBox(group);
  }

  frameAll() {
    if (!this.modelRoot.children.length) return;
    this.frameObject(this.modelRoot);
  }

  frameObject(object) {
    this.frameBox(new THREE.Box3().setFromObject(object));
  }

  frameBox(box) {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.orbit.target).normalize();
    const distance = Math.max(2, sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * 1.15);
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.001, distance / 1000);
    this.camera.far = Math.max(5000, distance * 100);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  setView(view) {
    const target = this.orbit.target.clone();
    const distance = Math.max(6, this.camera.position.distanceTo(target));
    if (view === 'front') {
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(target).add(new THREE.Vector3(0, 0, distance));
    } else if (view === 'right') {
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(target).add(new THREE.Vector3(distance, 0, 0));
    } else if (view === 'top') {
      this.camera.up.set(0, 0, -1);
      this.camera.position.copy(target).add(new THREE.Vector3(0, distance, 0));
    }
    this.camera.lookAt(target);
    this.orbit.update();
  }

  getRotationDegrees(object = this.selected) {
    if (!object) return null;
    return {
      x: object.rotation.x * DEG,
      y: object.rotation.y * DEG,
      z: object.rotation.z * DEG,
    };
  }

  getTopLevelSelection() {
    return this.getSelectedObjects().filter((object) => {
      let parent = object.parent;
      while (parent && parent !== this.modelRoot) {
        if (this.selectedObjects.has(parent)) return false;
        parent = parent.parent;
      }
      return true;
    });
  }

  isAncestorOf(ancestor, object) {
    let parent = object?.parent;
    while (parent) {
      if (parent === ancestor) return true;
      parent = parent.parent;
    }
    return false;
  }

  beginHistory(label) {
    if (this.pendingHistory) return;
    this.pendingHistory = { label, state: this.captureState() };
  }

  commitHistory() {
    if (!this.pendingHistory) return;
    this.pushUndoEntry(this.pendingHistory);
    this.pendingHistory = null;
  }

  cancelHistory() {
    if (!this.pendingHistory) return;
    this.disposeState(this.pendingHistory.state);
    this.pendingHistory = null;
  }

  checkpoint(label) {
    this.cancelHistory();
    this.pushUndoEntry({ label, state: this.captureState() });
  }

  pushUndoEntry(entry) {
    this.undoStack.push(entry);
    while (this.undoStack.length > HISTORY_LIMIT) this.disposeState(this.undoStack.shift().state);
    this.clearHistoryStack(this.redoStack);
    this.emitHistory();
  }

  undo() {
    this.cancelHistory();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push({ label: entry.label, state: this.captureState() });
    this.restoreState(entry.state);
    this.disposeState(entry.state);
    this.events.onStatus(`Undo · ${entry.label}`);
    this.emitHistory();
    return true;
  }

  redo() {
    this.cancelHistory();
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push({ label: entry.label, state: this.captureState() });
    this.restoreState(entry.state);
    this.disposeState(entry.state);
    this.events.onStatus(`Redo · ${entry.label}`);
    this.emitHistory();
    return true;
  }

  captureState() {
    this.assignIds(this.modelRoot);
    return {
      root: this.cloneObjectDeep(this.modelRoot),
      selectedIds: this.getSelectedObjects().map((object) => object.userData.gluestackId),
      activeId: this.selected?.userData.gluestackId ?? null,
    };
  }

  restoreState(state) {
    this.clearSelection();
    for (const child of [...this.modelRoot.children]) {
      this.modelRoot.remove(child);
      this.disposeObjectResources(child);
    }

    for (const child of state.root.children) this.modelRoot.add(this.cloneObjectDeep(child));
    this.assignIds(this.modelRoot);

    const byId = new Map();
    this.modelRoot.traverse((object) => {
      if (object.userData.gluestackId) byId.set(object.userData.gluestackId, object);
    });
    const selected = state.selectedIds.map((id) => byId.get(id)).filter(Boolean);
    const active = byId.get(state.activeId) ?? selected.at(-1) ?? null;
    this.selectMany(selected, active);
    this.events.onStructure();
    this.events.onTransform(this.selected);
  }

  disposeState(state) {
    if (state?.root) this.disposeObjectResources(state.root);
  }

  clearHistoryStack(stack) {
    for (const entry of stack) this.disposeState(entry.state);
    stack.length = 0;
  }

  emitHistory() {
    this.events.onHistory({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? '',
      redoLabel: this.redoStack.at(-1)?.label ?? '',
    });
  }
}
