import { restoreSourceLayers } from '../edit/component-visibility.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeRootUserData } from './metadata-policy.js';

export function createCleanExportRoot(editor) {
  const root = cloneSkeleton(editor.modelRoot);
  restoreSourceLayers(editor.modelRoot, root);
  sanitizeRootUserData(root, 'runtime');
  return root;
}

export async function exportCleanGlbBuffer(editor, options = {}) {
  const root = createCleanExportRoot(editor);
  const profile = editor.exportProfile ?? {};
  const maxTextureSize = Math.max(128, Number(options.maxTextureSize ?? profile.maxTextureSize ?? 4096) || 4096);
  return new Promise((resolve, reject) => {
    editor.exporter.parse(
      root,
      resolve,
      reject,
      {
        binary: true,
        onlyVisible: false,
        trs: false,
        maxTextureSize,
        ...options,
        binary: true,
      },
    );
  });
}

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function installCleanExport(editor) {
  if (!editor || editor.__gluestackCleanExport) return editor?.__gluestackCleanExport ?? null;

  const api = {
    createRoot: () => createCleanExportRoot(editor),
    exportBuffer: (options = {}) => exportCleanGlbBuffer(editor, options),
  };

  editor.exportCleanBuffer = api.exportBuffer;
  editor.exportGlb = async (filename = 'model.glb', options = {}) => {
    if (editor.modelRoot.children.length === 0) throw new Error('Сцена пуста');
    const profileName = editor.exportProfile?.label ?? 'Generic glTF';
    editor.events.onStatus(`Экспорт GLB · ${profileName}…`);
    const data = await api.exportBuffer(options);
    downloadBuffer(data, filename);
    editor.events.onStatus(`${filename} экспортирован · ${profileName}`);
    return data;
  };

  editor.__gluestackCleanExport = api;
  return api;
}
