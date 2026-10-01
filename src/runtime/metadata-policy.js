export const USER_DATA_CLASS = Object.freeze({
  RUNTIME: 'runtime',
  EDITOR: 'editor',
  TRANSIENT: 'transient',
});

export function classifyUserDataKey(key) {
  const value = String(key || '');
  if (value.startsWith('__gluestack')) return USER_DATA_CLASS.TRANSIENT;
  if (value.startsWith('gluestack')) return USER_DATA_CLASS.EDITOR;
  return USER_DATA_CLASS.RUNTIME;
}

export function sanitizeUserData(userData, mode = 'runtime') {
  if (!userData || typeof userData !== 'object' || Array.isArray(userData)) return {};
  const output = {};
  for (const [key, value] of Object.entries(userData)) {
    const type = classifyUserDataKey(key);
    if (mode === 'runtime' && type !== USER_DATA_CLASS.RUNTIME) continue;
    if (mode === 'project' && type === USER_DATA_CLASS.TRANSIENT) continue;
    output[key] = value;
  }
  return output;
}

export function sanitizeRootUserData(root, mode = 'runtime') {
  root?.traverse?.((object) => {
    object.userData = sanitizeUserData(object.userData ?? {}, mode);
  });
  return root;
}

export function auditRootUserData(root) {
  const counts = { runtime: 0, editor: 0, transient: 0 };
  const keys = { runtime: new Set(), editor: new Set(), transient: new Set() };
  const objects = [];
  root?.traverse?.((object) => {
    const local = [];
    for (const key of Object.keys(object.userData ?? {})) {
      const type = classifyUserDataKey(key);
      counts[type] += 1;
      keys[type].add(key);
      local.push({ key, type });
    }
    if (local.length) objects.push({ object: object.name || object.type || 'Object3D', entries: local });
  });
  return {
    counts,
    keys: Object.fromEntries(Object.entries(keys).map(([type, set]) => [type, [...set].sort()])),
    objects,
  };
}

export function installMetadataPolicy(editor) {
  if (!editor) return null;
  if (editor.metadataPolicy) return editor.metadataPolicy;
  const api = {
    classifyKey: classifyUserDataKey,
    sanitizeUserData,
    sanitizeRoot: sanitizeRootUserData,
    audit: () => auditRootUserData(editor.modelRoot),
  };
  editor.metadataPolicy = api;
  return api;
}
