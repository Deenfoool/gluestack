const JOIN_SAFE_ATTRIBUTES = new Set(['position', 'normal', 'uv']);
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

function morphData(mesh) {
  if (mesh?.morphTargetInfluences?.length) return true;
  return Object.values(mesh?.geometry?.morphAttributes ?? {}).some((items) => items?.length);
}

function extraAttributes(mesh, allowed) {
  return Object.keys(mesh?.geometry?.attributes ?? {}).filter((name) => !allowed.has(name));
}

function materialUsesTextures(mesh) {
  const materials = Array.isArray(mesh?.material) ? mesh.material : mesh?.material ? [mesh.material] : [];
  return materials.some((material) => TEXTURE_SLOTS.some((slot) => material?.[slot]?.isTexture));
}

export function installDataIntegrity({ editor, editMode, gameReady }) {
  if (!editor || editor.__gluestackIntegrityGuards) return null;
  editor.__gluestackIntegrityGuards = true;

  if (editMode?.enter) {
    const originalEnter = editMode.enter.bind(editMode);
    editMode.enter = (mesh = editor.selected) => {
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

  const controller = gameReady?.controller;
  if (controller?.generateLOD) {
    const originalGenerateLOD = controller.generateLOD.bind(controller);
    controller.generateLOD = (...args) => {
      const mesh = editor.selected;
      if (mesh?.isMesh) {
        const extras = extraAttributes(mesh, new Set(['position', 'normal']));
        if (extras.length || materialUsesTextures(mesh)) {
          controller.status(`LOD отменён: SimplifyModifier не сохраняет безопасно ${extras.length ? extras.join(', ') : 'texture coordinates'}`);
          return false;
        }
        if (morphData(mesh)) {
          controller.status('LOD отменён: morph targets требуют отдельного LOD pipeline');
          return false;
        }
      }
      return originalGenerateLOD(...args);
    };
  }

  return {
    editGuarded: Boolean(editMode?.enter),
    joinGuarded: true,
    lodGuarded: Boolean(controller?.generateLOD),
  };
}
