const STACK_KEY = 'gluestackModifierStack';

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
    editor.exportGlb = async (...args) => {
      const metadata = [];
      editor.modelRoot.traverse((object) => {
        if (!object.userData || !Object.prototype.hasOwnProperty.call(object.userData, STACK_KEY)) return;
        metadata.push([object, structuredClone(object.userData[STACK_KEY])]);
        delete object.userData[STACK_KEY];
      });
      try {
        return await originalExportGlb(...args);
      } finally {
        for (const [object, stack] of metadata) object.userData[STACK_KEY] = stack;
      }
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
