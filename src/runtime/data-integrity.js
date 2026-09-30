const JOIN_SAFE_ATTRIBUTES = new Set(['position', 'normal', 'uv']);

function morphData(mesh) {
  if (mesh?.morphTargetInfluences?.length) return true;
  return Object.values(mesh?.geometry?.morphAttributes ?? {}).some((items) => items?.length);
}

function extraAttributes(mesh, allowed) {
  return Object.keys(mesh?.geometry?.attributes ?? {}).filter((name) => !allowed.has(name));
}

export function installDataIntegrity({ editor, editMode }) {
  if (!editor || editor.__gluestackIntegrityGuards) return null;
  editor.__gluestackIntegrityGuards = true;

  if (editMode?.enter) {
    const originalEnter = editMode.enter.bind(editMode);
    editMode.enter = (mesh = editor.selected) => {
      if (editor.modifierStack?.hasStack?.(mesh)) {
        editor.events.onStatus('Edit Mode отменён: сначала Apply Stack или Clear Stack');
        return false;
      }
      if (mesh?.isInstancedMesh) {
        editor.events.onStatus('Edit Mode отменён: InstancedMesh требует отдельного instance-aware editor');
        return false;
      }
      if (morphData(mesh)) {
        editor.events.onStatus('Edit Mode отменён: morph targets пока не поддерживаются без потери данных');
        return false;
      }
      return originalEnter(mesh);
    };
  }

  const originalJoin = editor.joinSelected.bind(editor);
  editor.joinSelected = () => {
    const meshes = editor.getTopLevelSelection().filter((object) => object.isMesh && !object.isSkinnedMesh);
    if (editor.modifierStack?.hasStack && meshes.some((mesh) => editor.modifierStack.hasStack(mesh))) {
      editor.events.onStatus('Join отменён: сначала Apply Stack или Clear Stack на выбранных Mesh');
      return false;
    }
    if (meshes.some((mesh) => mesh.isInstancedMesh)) {
      editor.events.onStatus('Join отменён: InstancedMesh нельзя объединять обычным mesh pipeline');
      return false;
    }
    const extras = [...new Set(meshes.flatMap((mesh) => extraAttributes(mesh, JOIN_SAFE_ATTRIBUTES)))];
    if (meshes.some(morphData)) {
      editor.events.onStatus('Join отменён: morph targets пока не объединяются без потери данных');
      return false;
    }
    if (extras.length) {
      editor.events.onStatus(`Join отменён: текущий merge потеряет атрибуты ${extras.join(', ')}`);
      return false;
    }
    return originalJoin();
  };

  return {
    editGuarded: Boolean(editMode?.enter),
    joinGuarded: true,
    modifierStackGuarded: true,
  };
}
