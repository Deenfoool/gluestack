import { PropertyBinding } from 'three';

const parseQueues = new WeakMap();

function normalizePath(value = '', uri = false) {
  if (uri) {
    value = value.split(/[?#]/)[0];
    try { value = decodeURIComponent(value); } catch {}
  }
  const segments = [];
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' && segments.length && segments.at(-1) !== '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function isExternalUri(uri) {
  return Boolean(uri) && !/^(?:data:|blob:|https?:)/i.test(uri);
}

const DECODER_REQUIRED = new Map([
  ['KHR_draco_mesh_compression', 'Draco decoder пока не подключён'],
  ['KHR_texture_basisu', 'KTX2/Basis decoder пока не подключён'],
  ['EXT_meshopt_compression', 'Meshopt decoder пока не подключён'],
]);

// Built-in GLTFLoader extensions in our pinned Three.js 0.180.0. A required
// unknown extension cannot be treated as a warning: the loader may ignore it.
const SUPPORTED_EXTENSIONS = new Set([
  'KHR_lights_punctual', 'KHR_materials_clearcoat', 'KHR_materials_dispersion',
  'KHR_materials_ior', 'KHR_materials_sheen', 'KHR_materials_specular',
  'KHR_materials_transmission', 'KHR_materials_iridescence', 'KHR_materials_anisotropy',
  'KHR_materials_unlit', 'KHR_materials_volume', 'KHR_texture_transform',
  'KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'EXT_materials_bump',
  'EXT_texture_webp', 'EXT_texture_avif', 'EXT_mesh_gpu_instancing',
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

function resolveFile(map, uri, baseDirectory = '') {
  if (/^(?:data:|blob:|https?:|\/\/)/i.test(uri)) return { file: null, key: uri, ambiguous: [] };
  const normalized = normalizePath(uri, true);
  const relative = baseDirectory ? normalizePath(`${baseDirectory}/${normalized}`) : normalized;
  for (const key of [...new Set([relative, normalized, normalized.split('/').pop()].filter(Boolean))]) {
    const candidates = map.get(key) ?? [];
    if (candidates.length === 1) return { file: candidates[0], key, ambiguous: [] };
    if (candidates.length > 1) return { file: null, key, ambiguous: candidates };
  }
  return { file: null, key: normalized, ambiguous: [] };
}

function referencedUris(json) {
  return [...(json.buffers ?? []).map((item) => item?.uri), ...(json.images ?? []).map((item) => item?.uri)].filter(isExternalUri);
}

function validateReferences(map, uris, baseDirectory) {
  const missing = [];
  const ambiguous = [];
  for (const uri of [...new Set(uris)]) {
    const resolved = resolveFile(map, uri, baseDirectory);
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
  for (const extension of required) if (!DECODER_REQUIRED.has(extension) && !SUPPORTED_EXTENSIONS.has(extension)) {
    blocked.push(`${extension}: обязательное расширение не поддерживается`);
  }
  for (const extension of used) if (!required.includes(extension) && !DECODER_REQUIRED.has(extension) && !SUPPORTED_EXTENSIONS.has(extension)) {
    warnings.push(`${extension}: необязательное расширение может не сохраниться при экспорте`);
  }
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

function retargetTrackName(trackName, renamed) {
  const parsed = PropertyBinding.parseTrackName(trackName);
  const nextName = renamed.get(parsed.nodeName);
  let next = nextName && trackName.startsWith(`${parsed.nodeName}.`)
    ? `${nextName}${trackName.slice(parsed.nodeName.length)}` : trackName;
  // Rename each original target exactly once. Chaining A→A.001→A.001.001
  // would redirect A's animation to a different imported object.
  next = next.replace(/bones\[([^\]]+)\]/g, (match, name) => renamed.has(name) ? `bones[${renamed.get(name)}]` : match);
  return next;
}

function makeImportedNamesUnique(editor, gltf, label, replace = false) {
  if (!gltf?.scene) return 0;
  if (!gltf.scene.name) gltf.scene.name = label || 'Imported';
  const used = new Set();
  if (!replace) editor.modelRoot?.traverse?.((object) => { if (object.name) used.add(object.name); });
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
    for (const clip of gltf.animations ?? []) for (const track of clip.tracks ?? []) {
      const next = retargetTrackName(track.name, renamed);
      if (next !== track.name) track.name = next;
    }
  }
  return changed;
}

function addImportedScene(editor, gltf, label, warnings = [], { replace = false } = {}) {
  if (!gltf?.scene?.isObject3D) throw new Error('Файл не содержит корректную default scene');
  isolateEditableResources(gltf.scene);
  const renamed = makeImportedNamesUnique(editor, gltf, label, replace);
  const imported = gltf.scene;
  editor.assignIds(imported, true);
  if ((gltf.scenes?.length ?? 0) > 1) warnings.push(`Файл содержит ${gltf.scenes.length} scenes; импортирована default scene`);
  if (warnings.length) imported.userData.gluestackImportWarnings = [...new Set(warnings)];
  // Parsing, URI/extension validation and preparation must finish before the
  // old project is touched. Replacement is one Undo operation.
  editor.checkpoint('Import');
  if (replace) {
    editor.clearSelection();
    for (const child of [...editor.modelRoot.children]) {
      editor.modelRoot.remove(child);
      editor.disposeObjectResources(child);
    }
    editor.modifierStack?.pruneCaches?.();
  }
  editor.modelRoot.add(imported);
  if (editor.registerAnimations) editor.registerAnimations(gltf.animations ?? [], { replace });
  else editor.animations = replace ? [...(gltf.animations ?? [])] : [...(editor.animations ?? []), ...(gltf.animations ?? [])];
  editor.select(imported);
  editor.events.onStructure();
  const clips = gltf.animations?.length ?? 0;
  const details = [clips ? `animations ${clips}` : '', renamed ? `renamed nodes ${renamed}` : '', warnings.length ? warnings.join('; ') : ''].filter(Boolean).join(' · ');
  editor.events.onStatus(`${label} импортирован${details ? ` · ${details}` : ''}`);
  return imported;
}

function parseGltf(editor, payload, fileMap = null, baseDirectory = '') {
  const loader = editor.loader;
  const manager = loader.manager;
  const previous = parseQueues.get(manager) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(() => parseWithResolver(loader, payload, fileMap, baseDirectory));
  parseQueues.set(manager, job);
  job.finally(() => { if (parseQueues.get(manager) === job) parseQueues.delete(manager); }).catch(() => {});
  return job;
}

async function parseWithResolver(loader, payload, fileMap, baseDirectory) {
  const urls = new Map();
  const manager = loader.manager;
  if (fileMap) manager.setURLModifier((url) => {
    const resolved = resolveFile(fileMap, url, baseDirectory);
    if (!resolved.file) return url;
    if (!urls.has(resolved.file)) urls.set(resolved.file, URL.createObjectURL(resolved.file));
    return urls.get(resolved.file);
  });
  try {
    return await new Promise((resolve, reject) => loader.parse(payload, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error)))));
  } finally {
    if (fileMap) manager.setURLModifier(undefined);
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

function inspectGlbJson(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new Error('GLB повреждён: неполный заголовок');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('GLB повреждён: неверная сигнатура');
  if (view.getUint32(4, true) !== 2) throw new Error('Поддерживается только GLB версии 2');
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB повреждён: размер файла не совпадает с заголовком');
  let offset = 12;
  let json = null;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (length % 4 || end > buffer.byteLength) throw new Error('GLB повреждён: некорректная длина chunk');
    if (offset === 12 && type !== 0x4e4f534a) throw new Error('GLB повреждён: первый chunk должен содержать JSON');
    if (type === 0x4e4f534a) {
      if (json) throw new Error('GLB повреждён: повторный JSON chunk');
      try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)).replace(/\u0000+$/g, '').trim()); }
      catch { throw new Error('GLB повреждён: некорректный JSON chunk'); }
    }
    offset = end;
  }
  if (offset !== buffer.byteLength || !json || typeof json !== 'object' || Array.isArray(json)) throw new Error('GLB повреждён: неполная структура chunks');
  return json;
}

export async function parseSelectedFiles(editor, files) {
  const allFiles = [...(files ?? [])];
  const primaryFiles = allFiles.filter((file) => /\.(?:glb|gltf)$/i.test(file.name));
  if (primaryFiles.length !== 1) throw new Error('Выберите ровно один .glb/.gltf и, при необходимости, его .bin/текстуры');

  const primary = primaryFiles[0];
  const baseDirectory = normalizePath(primary.webkitRelativePath || primary.name).split('/').slice(0, -1).join('/');
  const label = primary.name.replace(/\.(?:glb|gltf)$/i, '');
  const sidecars = allFiles.filter((file) => file !== primary);
  const fileMap = makeFileMap(sidecars);
  const warnings = [];

  const binary = /\.glb$/i.test(primary.name);
  const payload = binary ? await primary.arrayBuffer() : await primary.text();
  let json;
  if (binary) json = inspectGlbJson(payload);
  else {
    try { json = JSON.parse(payload); } catch { throw new Error('Некорректный JSON в .gltf'); }
  }
  const policy = extensionPolicy(json);
  if (policy.blocked.length) throw new Error(`Импорт не поддерживается: ${policy.blocked.join('; ')}`);
  warnings.push(...policy.warnings);
  const refs = validateReferences(fileMap, referencedUris(json), baseDirectory);
  if (refs.ambiguous.length) throw new Error(`Неоднозначные sidecar-файлы: ${refs.ambiguous.map((item) => `${item.uri} → ${item.files.join(' / ')}`).join('; ')}`);
  if (refs.missing.length) throw new Error(`Не выбраны связанные файлы: ${refs.missing.join(', ')}`);
  const gltf = await parseGltf(editor, payload, sidecars.length ? fileMap : null, baseDirectory);
  return { gltf, label, primary, warnings, json };
}

export async function importSelectedFiles(editor, files, options = {}) {
  const parsed = await parseSelectedFiles(editor, files);
  return addImportedScene(editor, parsed.gltf, parsed.label, parsed.warnings, options);
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
    importFiles: (files, options) => importSelectedFiles(editor, files, options),
    extensionPolicy,
    resolveFile,
  };
}
