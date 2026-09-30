import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const STACK_KEY = 'gluestackModifierStack';

function downloadGlb(data, filename) {
  const blob = new Blob([data], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function installModifierStackWorkspaceGuard(editor) {
  if (!editor || editor.__modifierStackWorkspaceGuard) return editor?.__modifierStackWorkspaceGuard ?? null;

  const selectedHasStack = () => (
    editor.getSelectedObjects?.().some((object) => editor.modifierStack?.hasStack?.(object))
  );

  const workspaceHandler = (event) => {
    const tab = event.target?.closest?.('.workspace-tab');
    if (!tab || tab.dataset.workspace !== 'uv') return;
    const mesh = editor.selected;
    if (!editor.modifierStack?.hasStack?.(mesh)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.events.onStatus('UV Editing: сначала Apply Stack или Clear Stack');
  };
  document.addEventListener('click', workspaceHandler, true);

  const originals = {};
  const guardMethod = (name, label) => {
    if (typeof editor[name] !== 'function') return;
    originals[name] = editor[name].bind(editor);
    editor[name] = (...args) => {
      if (selectedHasStack()) {
        editor.events.onStatus(`${label}: сначала Apply Stack или Clear Stack`);
        return false;
      }
      return originals[name](...args);
    };
  };

  guardMethod('duplicateSelected', 'Duplicate');
  guardMethod('separateSelected', 'Separate');
  guardMethod('applyTransform', 'Apply Transform');
  guardMethod('originToGeometry', 'Origin to Geometry');

  const originalExportGlb = editor.exportGlb?.bind(editor);
  if (originalExportGlb) {
    editor.exportGlb = async (filename = 'model.glb') => {
      if (editor.modelRoot.children.length === 0) throw new Error('Сцена пуста');
      editor.events.onStatus('Экспорт GLB…');
      const root = cloneSkeleton(editor.modelRoot);
      root.traverse((object) => {
        if (object.userData) delete object.userData[STACK_KEY];
      });
      const data = await new Promise((resolve, reject) => {
        editor.exporter.parse(
          root,
          resolve,
          reject,
          { binary: true, onlyVisible: false, trs: false, maxTextureSize: 4096 },
        );
      });
      downloadGlb(data, filename);
      editor.events.onStatus(`${filename} экспортирован · modifier stack metadata исключены`);
    };
  }

  const api = {
    dispose() {
      document.removeEventListener('click', workspaceHandler, true);
      for (const [name, original] of Object.entries(originals)) editor[name] = original;
      if (originalExportGlb) editor.exportGlb = originalExportGlb;
    },
  };
  editor.__modifierStackWorkspaceGuard = api;
  return api;
}
