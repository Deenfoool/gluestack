import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeRootUserData } from './metadata-policy.js';

export function createCleanExportRoot(editor) {
  const root = cloneSkeleton(editor.modelRoot);
  sanitizeRootUserData(root, 'runtime');
  return root;
}

export async function exportCleanGlbBuffer(editor) {
  const root = createCleanExportRoot(editor);
  return new Promise((resolve, reject) => {
    editor.exporter.parse(
      root,
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
    exportBuffer: () => exportCleanGlbBuffer(editor),
  };

  editor.exportCleanBuffer = api.exportBuffer;
  editor.exportGlb = async (filename = 'model.glb') => {
    if (editor.modelRoot.children.length === 0) throw new Error('Сцена пуста');
    editor.events.onStatus('Экспорт чистого GLB…');
    const data = await api.exportBuffer();
    downloadBuffer(data, filename);
    editor.events.onStatus(`${filename} экспортирован`);
    return data;
  };

  editor.__gluestackCleanExport = api;
  return api;
}
