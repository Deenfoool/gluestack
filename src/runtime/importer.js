function normalizePath(value = '') {
  try { value = decodeURIComponent(value); } catch {}
  return value.replace(/\\/g, '/').replace(/^\.\//, '').split(/[?#]/)[0];
}

function isExternalUri(uri) {
  return Boolean(uri) && !/^(?:data:|blob:|https?:)/i.test(uri);
}

const DECODER_REQUIRED = new Map([
  ['KHR_draco_mesh_compression', 'Draco decoder пока не подключён'],
  ['KHR_texture_basisu', 'KTX2/Basis decoder пока не подключён'],
  ['EXT_meshopt_compression', 'Meshopt decoder пока не подключён'],
]);

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
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.includes(file)) list.push(file);
    }
  }
  return map;
}

function resolveFile(map, uri) {
  const normalized = normalizePath(uri);
  for (const key of [normalized, normalized.split('/').pop()].filter(Boolean)) {
    const candidates = map.get(key) ?? [];
    if (candidates.length === 1) return { file: candidates[0], key, ambiguous: [] };
    if (candidates.length > 1) return { file: null, key, ambiguous: candidates };
  }
  return { file: null, key: normalized, ambiguous: [] };
}

function referencedUris(json) {
  return [...(json.buffers ?? []).map((item) => item?.uri), ...(json.images ?? []).map((item) => item?.uri)].filter(isExternalUri);
}

function validateReferences(map, uris) {
  const missing = [];
  const ambiguous = [];
  for (const uri of [...new Set(uris)]) {
    const resolved = resolveFile(map, uri);
    if (resolved.ambiguous.length) ambiguous.push({ uri, files: resolved.ambiguous.map((file) => file.webkitRelativePath || file.name) });
    else if (!resolved.file) missing.push(uri);
  }
  return { missing, ambiguous };
}

function extensionPolicy(json) {
  const required = [...new Set(json?.extensionsRequired ?? [])];
  const used = [...new Set(json?.extensionsUsed ?? [])];
  const blocked = [];
  const warnings = [];
  for (const extension of required) if (DECODER_REQUIRED.has(extension)) blocked.push(`${extension}: ${DECODER_REQUIRED.get(extension)}`);
  for (const extension of used) if (DECODER_REQUIRED.has(extension) && !required.includes(extension)) warnings.push(`${extension}: ${DECODER_REQUIRED.get(extension)}`);
  const unknownRequired = required.filter((extension) => !DECODER_REQUIRED.has(extension));
  if (unknownRequired.length) warnings.push(`required extensions будут проверены GLTFLoader: ${unknownRequired.join(', ')}`);
  return { blocked, warnings, required, used };
}

function isolateEditableResources(root) {
  root?.traverse?.((object) => {
    if (!object.isMesh || object.isSkinnedMesh) return;
    if (object.geometry?.clone) object.geometry = object.geometry.clone();
    if (Array.isArray(object.material)) object.material = object.material.map((material) => material?.clone?.() ?? material);
    else if (object.material?.clone) object.material = object.material.clone();
  });
  return root;
}

function uniqueNameInSet(base, used) {
  const clean = String(base || 'Object').trim() || 'Object';
  if (!used.has(clean)) { used.add(clean); return clean; }
  let index = 1;
  let candidate;
  do { candidate = `${clean}.${String(index).padStart(3, '0')}`; index += 1; } while (used.has(candidate));
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
  gltf.scene.traverse((object) => { if (object.name) counts.set(object.name, (counts.get(object.name) ?? 0) + 1); });
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
    for (const clip of gltf.animations ?? []) for (const track of clip.tracks ?? []) for (const [oldName, newName] of renamed) {
      const next = retargetTrackName(track.name, oldName, newName);
      if (next !== track.name) track.name = next;
    }
  }
  return changed;
}

function addImportedScene(editor, gltf, label, warnings = []) {
  editor.checkpoint('Import');
  isolateEditableResources(gltf.scene);
  const renamed = makeImportedNamesUnique(editor, gltf, label);
  const imported = gltf.scene;
  editor.assignIds(imported, true);
  if ((gltf.scenes?.length ?? 0) > 1) warnings.push(`Файл содержит ${gltf.scenes.length} scenes; импортирована default scene`);
  if (warnings.length) imported.userData.gluestackImportWarnings = [...new Set(warnings)];
  editor.modelRoot.add(imported);
  editor.registerAnimations?.(gltf.animations ?? [], { replace: false });
  editor.select(imported);
  editor.events.onStructure();
  const clips = gltf.animations?.length ?? 0;
  const details = [clips ? `animations ${clips}` : '', renamed ? `renamed nodes ${renamed}` : '', warnings.length ? `warnings ${warnings.length}` : ''].filter(Boolean).join(' · ');
  editor.events.onStatus(`${label} импортирован${details ? ` · ${details}` : ''}`);
  return imported;
}

function parseGltf(editor, payload) {
  return new Promise((resolve, reject) => editor.loader.parse(payload, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error)))));
}

async function parseWithResolver(editor, payload, fileMap) {
  const urls = new Map();
  const manager = editor.loader.manager;
  manager.setURLModifier((url) => {
    const resolved = resolveFile(fileMap, url);
    if (!resolved.file) return url;
    if (!urls.has(resolved.file)) urls.set(resolved.file, URL.createObjectURL(resolved.file));
    return urls.get(resolved.file);
  });
  try { return await parseGltf(editor, payload); }
  finally { manager.setURLModifier(undefined); for (const url of urls.values()) URL.revokeObjectURL(url); }
}

function inspectGlbJson(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) return null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.byteLength) return null;
    if (type === 0x4e4f534a) {
      try { return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)).replace(/\u0000+$/g, '').trim()); }
      catch { return null; }
    }
    offset = end;
  }
  return null;
}

export async function parseSelectedFiles(editor, files) {
  const allFiles = [...(files ?? [])];
  const primaryFiles = allFiles.filter((file) => /\.(?:glb|gltf)$/i.test(file.name));
  if (primaryFiles.length !== 1) throw new Error('Выберите ровно один .glb/.gltf и, при необходимости, его .bin/текстуры');

  const primary = primaryFiles[0];
  const label = primary.name.replace(/\.(?:glb|gltf)$/i, '');
  const sidecars = allFiles.filter((file) => file !== primary);
  const fileMap = makeFileMap(sidecars);
  const warnings = [];

  if (/\.glb$/i.test(primary.name)) {
    const payload = await primary.arrayBuffer();
    const json = inspectGlbJson(payload);
    if (json) {
      const policy = extensionPolicy(json);
      if (policy.blocked.length) throw new Error(`Нужны неподключённые декодеры: ${policy.blocked.join('; ')}`);
      warnings.push(...policy.warnings);
      const refs = validateReferences(fileMap, referencedUris(json));
      if (refs.ambiguous.length) throw new Error(`Неоднозначные sidecar-файлы: ${refs.ambiguous.map((item) => `${item.uri} → ${item.files.join(' / ')}`).join('; ')}`);
      if (refs.missing.length) throw new Error(`Не выбраны связанные файлы: ${refs.missing.join(', ')}`);
    }
    const gltf = sidecars.length ? await parseWithResolver(editor, payload, fileMap) : await parseGltf(editor, payload);
    return { gltf, label, primary, warnings, json };
  }

  const text = await primary.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Некорректный JSON в .gltf'); }
  const policy = extensionPolicy(json);
  if (policy.blocked.length) throw new Error(`Нужны неподключённые декодеры: ${policy.blocked.join('; ')}`);
  warnings.push(...policy.warnings);
  const refs = validateReferences(fileMap, referencedUris(json));
  if (refs.ambiguous.length) throw new Error(`Неоднозначные sidecar-файлы: ${refs.ambiguous.map((item) => `${item.uri} → ${item.files.join(' / ')}`).join('; ')}`);
  if (refs.missing.length) throw new Error(`Не выбраны связанные файлы: ${refs.missing.join(', ')}`);
  const gltf = sidecars.length ? await parseWithResolver(editor, text, fileMap) : await parseGltf(editor, text);
  return { gltf, label, primary, warnings, json };
}

export async function importSelectedFiles(editor, files) {
  const parsed = await parseSelectedFiles(editor, files);
  return addImportedScene(editor, parsed.gltf, parsed.label, parsed.warnings);
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
      const primary = files.find((file) => /\.(?:glb|gltf)$/i.test(file.name));
      editor.events.onStatus(`Импорт: ${primary?.name ?? 'files'}…`);
      await importSelectedFiles(editor, files);
    } catch (error) {
      console.error('[gluestack] import failed', error);
      editor.events.onStatus(`Ошибка импорта: ${error.message || error}`);
    } finally { input.value = ''; }
  };

  input.addEventListener('change', onChange, { capture: true });
  return {
    input,
    parseFiles: (files) => parseSelectedFiles(editor, files),
    importFiles: (files) => importSelectedFiles(editor, files),
    extensionPolicy,
    resolveFile,
  };
}
