function normalizePath(value = '') {
  try { value = decodeURIComponent(value); } catch {}
  return value.replace(/\\/g, '/').replace(/^\.\//, '').split(/[?#]/)[0];
}

function isExternalUri(uri) {
  return Boolean(uri) && !/^(?:data:|blob:|https?:)/i.test(uri);
}

function fileKeys(file) {
  const relative = normalizePath(file.webkitRelativePath || file.name);
  const name = normalizePath(file.name);
  const base = relative.split('/').pop();
  return new Set([relative, name, base].filter(Boolean));
}

function makeFileMap(files) {
  const map = new Map();
  for (const file of files) {
    for (const key of fileKeys(file)) {
      if (!map.has(key)) map.set(key, file);
    }
  }
  return map;
}

function resolveFile(map, uri) {
  const normalized = normalizePath(uri);
  return map.get(normalized) ?? map.get(normalized.split('/').pop()) ?? null;
}

function referencedUris(json) {
  return [
    ...(json.buffers ?? []).map((item) => item?.uri),
    ...(json.images ?? []).map((item) => item?.uri),
  ].filter(isExternalUri);
}

function uniqueMissing(map, uris) {
  return [...new Set(uris.filter((uri) => !resolveFile(map, uri)))];
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
  return root;
}

function uniqueNameInSet(base, used) {
  const clean = String(base || 'Object').trim() || 'Object';
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  let index = 1;
  let candidate;
  do {
    candidate = `${clean}.${String(index).padStart(3, '0')}`;
    index += 1;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function retargetTrackName(trackName, oldName, newName) {
  let next = trackName;
  if (next === oldName) next = newName;
  else if (next.startsWith(`${oldName}.`)) next = `${newName}${next.slice(oldName.length)}`;
  next = next.split(`.bones[${oldName}]`).join(`.bones[${newName}]`);
  if (next.startsWith(`bones[${oldName}]`)) next = `bones[${newName}]${next.slice(`bones[${oldName}]`.length)}`;
  return next;
}

function makeImportedNamesUnique(editor, gltf, label) {
  if (!gltf?.scene) return 0;
  if (!gltf.scene.name) gltf.scene.name = label || 'Imported';

  const used = new Set();
  editor.modelRoot?.traverse?.((object) => { if (object.name) used.add(object.name); });

  const counts = new Map();
  gltf.scene.traverse((object) => {
    if (!object.name) return;
    counts.set(object.name, (counts.get(object.name) ?? 0) + 1);
  });

  const renamed = new Map();
  let changed = 0;
  gltf.scene.traverse((object) => {
    if (!object.name) return;
    const oldName = object.name;
    const nextName = uniqueNameInSet(oldName, used);
    if (nextName === oldName) return;
    object.name = nextName;
    changed += 1;
    if ((counts.get(oldName) ?? 0) === 1) renamed.set(oldName, nextName);
  });

  if (renamed.size) {
    for (const clip of gltf.animations ?? []) {
      for (const track of clip.tracks ?? []) {
        for (const [oldName, newName] of renamed) {
          const next = retargetTrackName(track.name, oldName, newName);
          if (next !== track.name) track.name = next;
        }
      }
    }
  }
  return changed;
}

function addImportedScene(editor, gltf, label) {
  editor.checkpoint('Import');
  isolateEditableResources(gltf.scene);
  const renamed = makeImportedNamesUnique(editor, gltf, label);
  const imported = gltf.scene;
  editor.assignIds(imported, true);
  editor.modelRoot.add(imported);
  editor.registerAnimations?.(gltf.animations ?? [], { replace: false });
  editor.select(imported);
  editor.events.onStructure();
  const clips = gltf.animations?.length ?? 0;
  const details = [clips ? `animations ${clips}` : '', renamed ? `renamed nodes ${renamed}` : ''].filter(Boolean).join(' · ');
  editor.events.onStatus(`${label} импортирован${details ? ` · ${details}` : ''}`);
  return imported;
}

function parseGltf(editor, payload) {
  return new Promise((resolve, reject) => {
    editor.loader.parse(
      payload,
      '',
      resolve,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

async function parseWithResolver(editor, payload, fileMap, label) {
  const urls = new Map();
  const manager = editor.loader.manager;
  manager.setURLModifier((url) => {
    const file = resolveFile(fileMap, url);
    if (!file) return url;
    if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
    return urls.get(file);
  });

  try {
    const gltf = await parseGltf(editor, payload);
    return addImportedScene(editor, gltf, label);
  } finally {
    manager.setURLModifier(undefined);
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

export function installImportPipeline({ editor, editMode, knifeTool }) {
  const input = document.querySelector('#file-input');
  if (!input || input.dataset.gluestackMultiImport === 'true') return null;
  input.dataset.gluestackMultiImport = 'true';
  input.multiple = true;
  input.accept = '.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,model/gltf-binary,model/gltf+json,image/png,image/jpeg,image/webp';

  const onChange = async (event) => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      knifeTool?.cancel?.(true);
      if (editMode?.active) editMode.exit();

      const primaryFiles = files.filter((file) => /\.(?:glb|gltf)$/i.test(file.name));
      if (primaryFiles.length !== 1) {
        throw new Error('Выберите ровно один .glb/.gltf и, при необходимости, его .bin/текстуры');
      }

      const primary = primaryFiles[0];
      editor.events.onStatus(`Импорт: ${primary.name}…`);

      if (/\.glb$/i.test(primary.name)) {
        const payload = await primary.arrayBuffer();
        const gltf = await parseGltf(editor, payload);
        addImportedScene(editor, gltf, primary.name.replace(/\.glb$/i, ''));
        return;
      }

      const text = await primary.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error('Некорректный JSON в .gltf'); }

      const fileMap = makeFileMap(files.filter((file) => file !== primary));
      const missing = uniqueMissing(fileMap, referencedUris(json));
      if (missing.length) {
        throw new Error(`Не выбраны связанные файлы: ${missing.join(', ')}`);
      }

      await parseWithResolver(editor, text, fileMap, primary.name.replace(/\.gltf$/i, ''));
    } catch (error) {
      console.error('[gluestack] import failed', error);
      editor.events.onStatus(`Ошибка импорта: ${error.message || error}`);
    } finally {
      input.value = '';
    }
  };

  input.addEventListener('change', onChange, { capture: true });
  return { input };
}
