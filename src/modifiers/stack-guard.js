export function installModifierStackWorkspaceGuard(editor) {
  if (!editor || editor.__modifierStackWorkspaceGuard) return editor?.__modifierStackWorkspaceGuard ?? null;

  const handler = (event) => {
    const tab = event.target?.closest?.('.workspace-tab');
    if (!tab || tab.dataset.workspace !== 'uv') return;
    const mesh = editor.selected;
    if (!editor.modifierStack?.hasStack?.(mesh)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.events.onStatus('UV Editing: сначала Apply Stack или Clear Stack');
  };

  document.addEventListener('click', handler, true);
  const api = {
    dispose() { document.removeEventListener('click', handler, true); },
  };
  editor.__modifierStackWorkspaceGuard = api;
  return api;
}
