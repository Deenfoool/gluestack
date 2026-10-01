export const PROJECT_MAGIC = 'GLUESTACK1\n';
export const PROJECT_FORMAT = 'gluestack-project';
export const CURRENT_PROJECT_VERSION = 2;
export const MIN_PROJECT_VERSION = 1;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function migrateV1ToV2(metadata) {
  const next = structuredClone(metadata);
  next.version = 2;
  next.editor = {
    ...asObject(next.editor),
    snapEnabled: Boolean(next.editor?.snapEnabled),
  };
  next.selection = {
    ids: Array.isArray(next.selection?.ids) ? next.selection.ids : [],
    activeId: next.selection?.activeId ?? null,
  };
  next.viewport = asObject(next.viewport);
  next.integrity = asObject(next.integrity);
  return next;
}

const MIGRATIONS = new Map([
  [1, migrateV1ToV2],
]);

export function normalizeProjectMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Некорректные metadata проекта');
  }
  if (input.format !== PROJECT_FORMAT) {
    throw new Error('Неизвестный формат проекта');
  }

  let version = Number(input.version ?? 1);
  if (!Number.isInteger(version) || version < MIN_PROJECT_VERSION) {
    throw new Error(`Некорректная версия проекта: ${input.version ?? 'unknown'}`);
  }
  if (version > CURRENT_PROJECT_VERSION) {
    throw new Error(`Проект создан более новой версией gluestack (v${version}); поддерживается до v${CURRENT_PROJECT_VERSION}`);
  }

  let metadata = structuredClone(input);
  while (version < CURRENT_PROJECT_VERSION) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) throw new Error(`Нет migration path для проекта v${version}`);
    metadata = migrate(metadata);
    version = Number(metadata.version);
  }

  metadata.format = PROJECT_FORMAT;
  metadata.version = CURRENT_PROJECT_VERSION;
  metadata.name = typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : 'Untitled';
  metadata.selection = {
    ids: Array.isArray(metadata.selection?.ids) ? metadata.selection.ids.filter((id) => typeof id === 'string') : [],
    activeId: typeof metadata.selection?.activeId === 'string' ? metadata.selection.activeId : null,
  };
  metadata.editor = {
    ...asObject(metadata.editor),
    snapEnabled: Boolean(metadata.editor?.snapEnabled),
  };
  metadata.viewport = asObject(metadata.viewport);
  metadata.integrity = asObject(metadata.integrity);
  return metadata;
}

export function encodeProjectContainer(metadata, glb) {
  if (!(glb instanceof ArrayBuffer)) throw new Error('GLB payload должен быть ArrayBuffer');
  const normalized = normalizeProjectMetadata(metadata);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(normalized));
  const magic = new TextEncoder().encode(PROJECT_MAGIC);
  const output = new Uint8Array(magic.length + 4 + metadataBytes.length + glb.byteLength);
  output.set(magic, 0);
  new DataView(output.buffer).setUint32(magic.length, metadataBytes.length, true);
  output.set(metadataBytes, magic.length + 4);
  output.set(new Uint8Array(glb), magic.length + 4 + metadataBytes.length);
  return output.buffer;
}

export function decodeProjectContainer(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Файл проекта должен быть ArrayBuffer');
  const bytes = new Uint8Array(buffer);
  const magic = new TextEncoder().encode(PROJECT_MAGIC);
  if (bytes.length < magic.length + 4 + 20) throw new Error('Файл проекта повреждён или слишком мал');
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) throw new Error('Это не файл gluestack');
  }

  const metadataLength = new DataView(buffer).getUint32(magic.length, true);
  const metadataStart = magic.length + 4;
  const glbStart = metadataStart + metadataLength;
  if (metadataLength < 2 || glbStart > bytes.length - 20) {
    throw new Error('Некорректный заголовок проекта');
  }

  let rawMetadata;
  try {
    rawMetadata = JSON.parse(new TextDecoder().decode(bytes.slice(metadataStart, glbStart)));
  } catch {
    throw new Error('Metadata проекта повреждены');
  }
  const metadata = normalizeProjectMetadata(rawMetadata);
  const glb = buffer.slice(glbStart);

  const glbView = new DataView(glb);
  if (glb.byteLength < 20 || glbView.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Внутренний GLB payload повреждён');
  }
  return { metadata, glb };
}
