const MAGIC = 'GLUESTACK1\n';
const DB_NAME = 'gluestack-projects';
const DB_VERSION = 1;
const STORE = 'projects';
const AUTOSAVE_ID = '__autosave__';

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

export class ProjectController {
  constructor(editor, onStatus = null) {
    this.editor = editor;
    this.status = onStatus ?? ((message) => editor.events.onStatus(message));
    this.name = 'Untitled';
    this.dbPromise = this.openDb();
    this.autosaveTimer = null;
    this.autosaveDelay = 1800;
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
    const root = payload?.root ?? this.editor.modelRoot;
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

  metadata() {
    this.editor.assignIds(this.editor.modelRoot);
    return {
      format: 'gluestack-project',
      version: 2,
      name: this.name,
      savedAt: new Date().toISOString(),
      camera: {
        position: this.editor.camera.position.toArray(),
        quaternion: this.editor.camera.quaternion.toArray(),
        target: this.editor.orbit.target.toArray(),
        fov: this.editor.camera.fov,
      },
      selection: {
        ids: this.editor.getSelectedObjects().map((object) => object.userData.gluestackId).filter(Boolean),
        activeId: this.editor.selected?.userData.gluestackId ?? null,
      },
      editor: {
        snapEnabled: this.editor.snapEnabled,
      },
    };
  }

  async encodeProject() {
    const glb = await this.exportSceneBuffer({ project: true });
    const metadataBytes = new TextEncoder().encode(JSON.stringify(this.metadata()));
    const magic = new TextEncoder().encode(MAGIC);
    const output = new Uint8Array(magic.length + 4 + metadataBytes.length + glb.byteLength);
    output.set(magic, 0);
    new DataView(output.buffer).setUint32(magic.length, metadataBytes.length, true);
    output.set(metadataBytes, magic.length + 4);
    output.set(new Uint8Array(glb), magic.length + 4 + metadataBytes.length);
    return output.buffer;
  }

  decodeProject(buffer) {
    const bytes = new Uint8Array(buffer);
    const magicBytes = new TextEncoder().encode(MAGIC);
    if (bytes.length < magicBytes.length + 4) throw new Error('Файл проекта повреждён');
    for (let i = 0; i < magicBytes.length; i += 1) {
      if (bytes[i] !== magicBytes[i]) throw new Error('Это не файл gluestack');
    }
    const metadataLength = new DataView(buffer).getUint32(magicBytes.length, true);
    const metadataStart = magicBytes.length + 4;
    const glbStart = metadataStart + metadataLength;
    if (glbStart > bytes.length) throw new Error('Некорректный заголовок проекта');
    const metadata = JSON.parse(new TextDecoder().decode(bytes.slice(metadataStart, glbStart)));
    const glb = buffer.slice(glbStart);
    return { metadata, glb };
  }

  async loadGlbBuffer(buffer, metadata = {}) {
    const gltf = await new Promise((resolve, reject) => {
      this.editor.loader.parse(buffer, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error))));
    });
    isolateEditableResources(gltf.scene);

    this.editor.clearSelection();
    for (const child of [...this.editor.modelRoot.children]) {
      this.editor.modelRoot.remove(child);
      this.editor.disposeObjectResources(child);
    }
    for (const child of [...gltf.scene.children]) this.editor.modelRoot.add(child);
    if (this.editor.registerAnimations) this.editor.registerAnimations(gltf.animations ?? [], { replace: true });
    else this.editor.animations = [...(gltf.animations ?? [])];
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

    if (metadata.camera) {
      const { camera } = metadata;
      if (Array.isArray(camera.position)) this.editor.camera.position.fromArray(camera.position);
      if (Array.isArray(camera.quaternion)) this.editor.camera.quaternion.fromArray(camera.quaternion);
      if (Array.isArray(camera.target)) this.editor.orbit.target.fromArray(camera.target);
      if (Number.isFinite(camera.fov)) this.editor.camera.fov = camera.fov;
      this.editor.camera.updateProjectionMatrix();
      this.editor.orbit.update();
    }
    if (metadata.editor?.snapEnabled !== undefined) this.editor.setSnapEnabled(Boolean(metadata.editor.snapEnabled));
    this.name = metadata.name || 'Untitled';
    this.editor.events.onStructure();
    this.editor.events.onTransform(this.editor.selected);
    const clips = this.editor.animations?.length ?? 0;
    const stacks = [...this.editor.modelRoot.children].length && this.editor.modifierStack
      ? (() => {
          let count = 0;
          this.editor.modelRoot.traverse((object) => { if (this.editor.modifierStack.hasStack?.(object)) count += 1; });
          return count;
        })()
      : 0;
    this.status(`Проект «${this.name}» открыт${clips ? ` · animations ${clips}` : ''}${stacks ? ` · modifier stacks ${stacks}` : ''}`);
  }

  async openProjectBuffer(buffer) {
    const { metadata, glb } = this.decodeProject(buffer);
    if (metadata.format !== 'gluestack-project') throw new Error('Неизвестный формат проекта');
    await this.loadGlbBuffer(glb, metadata);
    return metadata;
  }

  async saveDownload(name = this.name) {
    this.name = safeName(name);
    this.status('Сохранение проекта…');
    const buffer = await this.encodeProject();
    downloadBlob(new Blob([buffer], { type: 'application/octet-stream' }), `${this.name}.gluestack`);
    await this.putRecord({ id: this.name, name: this.name, updatedAt: Date.now(), buffer });
    this.status(`Проект «${this.name}» сохранён`);
  }

  async saveLocal(name = this.name) {
    this.name = safeName(name);
    const buffer = await this.encodeProject();
    await this.putRecord({ id: this.name, name: this.name, updatedAt: Date.now(), buffer });
    this.status(`Локальный проект «${this.name}» сохранён`);
  }

  async autosave() {
    try {
      const buffer = await this.encodeProject();
      await this.putRecord({ id: AUTOSAVE_ID, name: this.name, updatedAt: Date.now(), buffer });
      this.status(`Autosave · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      console.warn('[gluestack] autosave failed', error);
    }
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosave(), this.autosaveDelay);
  }

  async recoverAutosave() {
    const record = await this.getRecord(AUTOSAVE_ID);
    if (!record?.buffer) throw new Error('Autosave ещё не создан');
    await this.openProjectBuffer(record.buffer);
    this.status(`Autosave восстановлен · ${new Date(record.updatedAt).toLocaleString()}`);
  }

  async listProjects() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.filter((item) => item.id !== AUTOSAVE_ID).sort((a, b) => b.updatedAt - a.updatedAt));
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
