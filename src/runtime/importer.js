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

function assertStaticGltf(gltf) {
  if (gltf?.animations?.length) {
    throw new Error(`Анимированный glTF пока не импортируется: найдено animation clips ${gltf.animations.length}. Это блокируется, чтобы экспорт не потерял анимацию.`);
  }
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

function addImportedScene(editor, imported, label) {
  editor.checkpoint('Import');
  isolateEditableResources(imported);
  imported.name = imported.name || label;
  editor.assignIds(imported, true);
  editor.modelRoot.add(imported);
  editor.select(imported);
  editor.events.onStructure();
  editor.events.onStatus(`${label} импортирован`);
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
    assertStaticGltf(gltf);
    return addImportedScene(editor, gltf.scene, label);
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
        assertStaticGltf(gltf);
        addImportedScene(editor, gltf.scene, primary.name.replace(/\.glb$/i, ''));
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
