const TEXTURE_SLOTS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'displacementMap',
  'emissiveMap', 'metalnessMap', 'roughnessMap', 'lightMap', 'envMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap',
  'sheenRoughnessMap', 'specularColorMap', 'specularIntensityMap',
  'thicknessMap', 'transmissionMap', 'anisotropyMap',
];

function collectMaterialTextures(material, target) {
  if (!material) return;
  for (const slot of TEXTURE_SLOTS) {
    if (material[slot]?.isTexture) target.add(material[slot]);
  }
}

function collectReferencedResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of objectMaterials) {
      materials.add(material);
      collectMaterialTextures(material, textures);
    }
  });

  return { geometries, materials, textures };
}

export function installResourceOwnership(editor) {
  if (!editor || editor.__gluestackSafeDisposal) return null;
  editor.__gluestackSafeDisposal = true;

  editor.disposeObjectResources = (object) => {
    if (!object) return;

    const candidates = collectReferencedResources(object);
    const live = collectReferencedResources(editor.modelRoot);

    for (const geometry of candidates.geometries) {
      if (!live.geometries.has(geometry)) geometry.dispose?.();
    }
    for (const material of candidates.materials) {
      if (!live.materials.has(material)) material.dispose?.();
    }
    for (const texture of candidates.textures) {
      if (!live.textures.has(texture)) texture.dispose?.();
    }
  };

  return { collectReferencedResources };
}
