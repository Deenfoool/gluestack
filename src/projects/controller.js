import { restoreSourceLayers } from '../edit/component-visibility.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeRootUserData } from '../runtime/metadata-policy.js';
import {
  CURRENT_PROJECT_VERSION,
  PROJECT_FORMAT,
  decodeProjectContainer,
  encodeProjectContainer,
} from './format.js';

const DB_NAME = 'gluestack-projects';
const DB_VERSION = 1;
const STORE = 'projects';
const AUTOSAVE_ID = '__autosave__';
const AUTOSAVE_BACKUP_ID = '__autosave_backup__';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(value) {
  return (value || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'project';
}

function isolateEditableResources(root) {
  root?.traverse?.((object) => {
    if (!object.isMesh || object.isSkinnedMesh) return;
    if (object.geometry?.clone) object.geometry = object.geometry.clone();
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material?.clone?.() ?? material);
    } else if (object.material?.clone) {
      object.material = object.material.clone();
    }
  });
}

function validateParsedScene(scene) {
  if (!scene?.isObject3D) throw new Error('В проекте отсутствует валидная сцена');
  let meshes = 0;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    meshes += 1;
    const position = object.geometry?.getAttribute?.('position');
    if (!position || position.itemSize < 3) throw new Error(`Mesh «${object.name || 'Unnamed'}» не содержит position`);
    for (let i = 0; i < position.count; i += 1) {
      if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) {
        throw new Error(`Mesh «${object.name || 'Unnamed'}» содержит NaN/Infinity`);
      }
    }
  });
  return { meshes };
}

function textureKeys() {
  return ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];
}

export class ProjectController {
  constructor(editor, onStatus = null) {
    this.editor = editor;
    this.status = onStatus ?? ((message) => editor.events.onStatus(message));
    this.name = 'Untitled';
    this.dbPromise = this.openDb();
    this.autosaveTimer = null;
    this.autosaveDelay = 1800;
    this.autosaveGeneration = 0;
    this.autosaveCommittedGeneration = 0;
    this.dirty = false;
    this.isLoading = false;
  }

  openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  setDirty(value, reason = '') {
    const next = Boolean(value);
    if (this.dirty === next) return false;
    this.dirty = next;
    window.dispatchEvent(new CustomEvent('gluestack:project-dirty', {
      detail: { dirty: this.dirty, name: this.name, reason },
    }));
    return true;
  }

  markDirty(reason = 'change') {
    if (this.isLoading) return false;
    return this.setDirty(true, reason);
  }

  async waitForModifierStack() {
    if (this.editor.modifierStack) return this.editor.modifierStack;
    if (this.editor.modifierStackReady) {
      try { await this.editor.modifierStackReady; } catch {}
    }
    return this.editor.modifierStack ?? null;
  }

  async exportSceneBuffer({ project = false } = {}) {
    const stack = project ? await this.waitForModifierStack() : null;
    const payload = stack?.createProjectExportRoot?.() ?? null;
    const root = payload?.root ?? (project ? cloneSkeleton(this.editor.modelRoot) : this.editor.modelRoot);
    if (project) restoreSourceLayers(this.editor.modelRoot, root);
    if (project) sanitizeRootUserData(root, 'project');
    try {
      return await new Promise((resolve, reject) => {
        this.editor.exporter.parse(
          root,
          resolve,
          reject,
          { binary: true, onlyVisible: false, trs: false, maxTextureSize: 4096 },
        );
      });
    } finally {
      if (payload) stack?.disposeProjectExportRoot?.(payload);
    }
  }

  viewportMetadata() {
    return {
      background: this.editor.scene.background?.isColor ? this.editor.scene.background.getHex() : null,
      exposure: this.editor.renderer.toneMappingExposure,
      cameraNear: this.editor.camera.near,
      cameraFar: this.editor.camera.far,
      cameraUp: this.editor.camera.up.toArray(),
    };
  }

  integritySummary() {
    const meshes = new Set();
    const materials = new Set();
    const textures = new Set();
    let modifierStacks = 0;
    this.editor.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      meshes.add(object);
      if (Array.isArray(object.userData?.gluestackModifierStack) && object.userData.gluestackModifierStack.length) modifierStacks += 1;
      const slots = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of slots) {
        if (!material) continue;
        materials.add(material);
        for (const key of textureKeys()) if (material[key]?.isTexture) textures.add(material[key]);
      }
    });
    return {
      meshes: meshes.size,
      materials: materials.size,
      textures: textures.size,
      animations: this.editor.animations?.length ?? 0,
      modifierStacks,
      userData: this.editor.metadataPolicy?.audit?.().counts ?? null,
    };
  }

  metadata() {
    this.editor.assignIds(this.editor.modelRoot);
    return {
      format: PROJECT_FORMAT,
      version: CURRENT_PROJECT_VERSION,
      name: this.name,
      savedAt: new Date().toISOString(),
      camera: {
        position: this.editor.camera.position.toArray(),
        quaternion: this.editor.camera.quaternion.toArray(),
        target: this.editor.orbit.target.toArray(),
        fov: this.editor.camera.fov,
      },
      viewport: this.viewportMetadata(),
      selection: {
        ids: this.editor.getSelectedObjects().map((object) => object.userData.gluestackId).filter(Boolean),
        activeId: this.editor.selected?.userData.gluestackId ?? null,
      },
      editor: {
        snapEnabled: this.editor.snapEnabled,
      },
      integrity: this.integritySummary(),
    };
  }

  async encodeProject() {
    const glb = await this.exportSceneBuffer({ project: true });
    return encodeProjectContainer(this.metadata(), glb);
  }

  decodeProject(buffer) {
    return decodeProjectContainer(buffer);
  }

  async prepareGlbBuffer(buffer) {
    const gltf = await new Promise((resolve, reject) => {
      this.editor.loader.parse(buffer, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error))));
    });
    validateParsedScene(gltf.scene);
    isolateEditableResources(gltf.scene);
    this.editor.assignIds(gltf.scene);
    return { scene: gltf.scene, animations: gltf.animations ?? [] };
  }

  restoreViewport(metadata) {
    const { camera = {}, viewport = {} } = metadata;
    if (Array.isArray(camera.position)) this.editor.camera.position.fromArray(camera.position);
    if (Array.isArray(camera.quaternion)) this.editor.camera.quaternion.fromArray(camera.quaternion);
    if (Array.isArray(camera.target)) this.editor.orbit.target.fromArray(camera.target);
    if (Number.isFinite(camera.fov)) this.editor.camera.fov = camera.fov;
    if (Number.isFinite(viewport.cameraNear)) this.editor.camera.near = Math.max(0.0001, viewport.cameraNear);
    if (Number.isFinite(viewport.cameraFar)) this.editor.camera.far = Math.max(this.editor.camera.near + 0.01, viewport.cameraFar);
    if (Array.isArray(viewport.cameraUp)) this.editor.camera.up.fromArray(viewport.cameraUp);
    if (Number.isInteger(viewport.background) && this.editor.scene.background?.isColor) this.editor.scene.background.setHex(viewport.background);
    if (Number.isFinite(viewport.exposure)) this.editor.renderer.toneMappingExposure = viewport.exposure;
    this.editor.camera.updateProjectionMatrix();
    this.editor.orbit.update();
  }

  async commitPreparedProject(prepared, metadata = {}) {
    this.isLoading = true;
    try {
      this.editor.clearSelection();
      for (const child of [...this.editor.modelRoot.children]) {
        this.editor.modelRoot.remove(child);
        this.editor.disposeObjectResources(child);
      }
      for (const child of [...prepared.scene.children]) this.editor.modelRoot.add(child);
      if (this.editor.registerAnimations) this.editor.registerAnimations(prepared.animations, { replace: true });
      else this.editor.animations = [...prepared.animations];
      this.editor.assignIds(this.editor.modelRoot);

      const stack = await this.waitForModifierStack();
      stack?.restoreAll?.();

      const byId = new Map();
      this.editor.modelRoot.traverse((object) => {
        if (object.userData?.gluestackId) byId.set(object.userData.gluestackId, object);
      });
      const selected = (metadata.selection?.ids ?? []).map((id) => byId.get(id)).filter(Boolean);
      const active = byId.get(metadata.selection?.activeId) ?? selected.at(-1) ?? null;
      if (selected.length) this.editor.selectMany(selected, active);
      else if (this.editor.modelRoot.children.length) this.editor.select(this.editor.modelRoot.children[0]);
      else this.editor.clearSelection();

      this.restoreViewport(metadata);
      if (metadata.editor?.snapEnabled !== undefined) this.editor.setSnapEnabled(Boolean(metadata.editor.snapEnabled));
      this.name = metadata.name || 'Untitled';
      this.editor.events.onStructure();
      this.editor.events.onTransform(this.editor.selected);
    } finally {
      this.isLoading = false;
    }

    const clips = this.editor.animations?.length ?? 0;
    const stacks = this.integritySummary().modifierStacks;
    this.setDirty(false, 'open');
    this.status(`Проект «${this.name}» открыт${clips ? ` · animations ${clips}` : ''}${stacks ? ` · modifier stacks ${stacks}` : ''}`);
  }

  async loadGlbBuffer(buffer, metadata = {}) {
    const prepared = await this.prepareGlbBuffer(buffer);
    await this.commitPreparedProject(prepared, metadata);
  }

  async openProjectBuffer(buffer) {
    const { metadata, glb } = this.decodeProject(buffer);
    const prepared = await this.prepareGlbBuffer(glb);
    await this.commitPreparedProject(prepared, metadata);
    return metadata;
  }

  async saveDownload(name = this.name) {
    this.name = safeName(name);
    this.status('Сохранение проекта…');
    const buffer = await this.encodeProject();
    downloadBlob(new Blob([buffer], { type: 'application/octet-stream' }), `${this.name}.gluestack`);
    await this.putRecord({ id: this.name, name: this.name, updatedAt: Date.now(), buffer });
    this.setDirty(false, 'save');
    this.status(`Проект «${this.name}» сохранён`);
    return buffer;
  }

  async saveLocal(name = this.name) {
    this.name = safeName(name);
    const buffer = await this.encodeProject();
    await this.putRecord({ id: this.name, name: this.name, updatedAt: Date.now(), buffer });
    this.setDirty(false, 'save-local');
    this.status(`Локальный проект «${this.name}» сохранён`);
    return buffer;
  }

  async commitAutosave(buffer, generation) {
    if (generation !== this.autosaveGeneration || generation < this.autosaveCommittedGeneration) return false;
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(AUTOSAVE_ID);
      let stale = false;

      request.onsuccess = () => {
        if (generation !== this.autosaveGeneration || generation < this.autosaveCommittedGeneration) {
          stale = true;
          tx.abort();
          return;
        }
        const current = request.result;
        if (current?.buffer) {
          store.put({
            ...current,
            id: AUTOSAVE_BACKUP_ID,
            backupOf: AUTOSAVE_ID,
            backedUpAt: Date.now(),
          });
        }
        store.put({
          id: AUTOSAVE_ID,
          name: this.name,
          updatedAt: Date.now(),
          generation,
          buffer,
        });
      };
      tx.oncomplete = () => {
        this.autosaveCommittedGeneration = Math.max(this.autosaveCommittedGeneration, generation);
        resolve(true);
      };
      tx.onabort = () => {
        if (stale) resolve(false);
        else reject(tx.error ?? new Error('Autosave transaction aborted'));
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async autosave(generation = this.autosaveGeneration) {
    if (!this.dirty || generation !== this.autosaveGeneration) return false;
    try {
      const buffer = await this.encodeProject();
      if (!this.dirty || generation !== this.autosaveGeneration) return false;
      const committed = await this.commitAutosave(buffer, generation);
      if (committed) this.status(`Autosave · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      return committed;
    } catch (error) {
      console.warn('[gluestack] autosave failed', error);
      return false;
    }
  }

  scheduleAutosave() {
    if (this.isLoading || !this.dirty) return false;
    const generation = ++this.autosaveGeneration;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosave(generation), this.autosaveDelay);
    return true;
  }

  async recoverAutosave({ backup = false } = {}) {
    const id = backup ? AUTOSAVE_BACKUP_ID : AUTOSAVE_ID;
    const record = await this.getRecord(id);
    if (!record?.buffer) throw new Error(backup ? 'Предыдущий autosave ещё не создан' : 'Autosave ещё не создан');
    await this.openProjectBuffer(record.buffer);
    this.setDirty(true, backup ? 'recover-backup' : 'recover-autosave');
    this.status(`${backup ? 'Предыдущий autosave' : 'Autosave'} восстановлен · ${new Date(record.updatedAt).toLocaleString()}`);
    return record;
  }

  async listProjects() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result
        .filter((item) => ![AUTOSAVE_ID, AUTOSAVE_BACKUP_ID].includes(item.id))
        .sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    });
  }

  async openLocal(name) {
    const record = await this.getRecord(name);
    if (!record?.buffer) throw new Error(`Проект «${name}» не найден`);
    await this.openProjectBuffer(record.buffer);
  }

  async putRecord(record) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getRecord(id) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }
}
