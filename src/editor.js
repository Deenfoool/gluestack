import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const DEG = THREE.MathUtils.RAD2DEG;

export class Editor3D {
  constructor(container, events = {}) {
    this.container = container;
    this.events = {
      onSelection: events.onSelection ?? (() => {}),
      onStructure: events.onStructure ?? (() => {}),
      onTransform: events.onTransform ?? (() => {}),
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
    this.transform.addEventListener('objectChange', () => {
      this.updateSelectionBox();
      this.events.onTransform(this.selected);
    });
    this.scene.add(this.transform.getHelper());

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Scene Collection';
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
    this.selectionBox = null;
    this.loader = new GLTFLoader();
    this.exporter = new GLTFExporter();

    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', (event) => this.handlePointerUp(event));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    this.newScene();
    this.animate();
  }

  animate = () => {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.orbit.update();
    this.updateSelectionBox();
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
    this.select(hit?.object ?? null);
  }

  newScene() {
    this.select(null);
    for (const child of [...this.modelRoot.children]) {
      this.disposeGenerated(child);
      this.modelRoot.remove(child);
    }
    this.addPrimitive('cube');
    this.events.onStatus('Новая сцена создана');
  }

  makeMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xb8b8b8,
      metalness: 0,
      roughness: 0.58,
      side: THREE.FrontSide,
    });
  }

  addPrimitive(type) {
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
    this.modelRoot.add(mesh);
    this.select(mesh);
    this.events.onStructure();
    this.events.onStatus(`${mesh.name} добавлен`);
    return mesh;
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

  select(object) {
    if (object === this.modelRoot) object = null;
    this.selected = object;
    this.transform.detach();

    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.geometry.dispose();
      this.selectionBox.material.dispose();
      this.selectionBox = null;
    }

    if (object) {
      this.transform.attach(object);
      this.selectionBox = new THREE.BoxHelper(object, 0xff9500);
      this.scene.add(this.selectionBox);
    }

    this.events.onSelection(object);
  }

  updateSelectionBox() {
    if (this.selectionBox) this.selectionBox.update();
  }

  setTransformMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.transform.setMode(mode);
  }

  deleteSelected() {
    const object = this.selected;
    if (!object || object === this.modelRoot || !object.parent) return;
    this.select(null);
    object.parent.remove(object);
    this.disposeGenerated(object);
    this.events.onStructure();
    this.events.onStatus(`${object.name || 'Object'} удалён`);
  }

  disposeGenerated(object) {
    object.traverse((child) => {
      if (!child.userData.gluestackGenerated) return;
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
      else child.material?.dispose?.();
    });
  }

  renameSelected(name) {
    if (!this.selected) return;
    const cleaned = name.trim();
    if (!cleaned) return;
    this.selected.name = cleaned;
    this.events.onStructure();
  }

  setTransformValue(path, value) {
    if (!this.selected || !Number.isFinite(value)) return;
    const [group, axis] = path.split('.');
    if (!this.selected[group] || !['x', 'y', 'z'].includes(axis)) return;
    this.selected[group][axis] = value;
    this.selected.updateMatrix();
    this.updateSelectionBox();
    this.events.onTransform(this.selected);
  }

  setVisible(object, visible) {
    if (!object || object === this.modelRoot) return;
    object.visible = visible;
    if (object === this.selected && !visible) this.select(null);
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
          const imported = gltf.scene;
          imported.name = imported.name || file.name.replace(/\.(glb|gltf)$/i, '');
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
    if (!this.selected) return this.frameAll();
    this.frameObject(this.selected);
  }

  frameAll() {
    if (!this.modelRoot.children.length) return;
    this.frameObject(this.modelRoot);
  }

  frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
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
}
