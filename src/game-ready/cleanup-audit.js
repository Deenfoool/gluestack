import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEXTURE_SLOTS } from '../runtime/resource-ownership.js';
import { refreshIcons } from '../ui.js';

function materialsOf(mesh) {
  return Array.isArray(mesh?.material) ? mesh.material.filter(Boolean) : mesh?.material ? [mesh.material] : [];
}

function collectMaterials(editor) {
  const result = new Set();
  editor.modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    materialsOf(object).forEach((material) => result.add(material));
  });
  return [...result];
}

function collectTextures(editor) {
  const result = new Set();
  for (const material of collectMaterials(editor)) {
    for (const slot of TEXTURE_SLOTS) if (material?.[slot]?.isTexture) result.add(material[slot]);
  }
  return [...result];
}

function materialSignature(material) {
  if (!material) return 'null';
  return JSON.stringify({
    type: material.type,
    color: material.color?.getHex?.() ?? null,
    emissive: material.emissive?.getHex?.() ?? null,
    emissiveIntensity: material.emissiveIntensity ?? 1,
    metalness: material.metalness ?? null,
    roughness: material.roughness ?? null,
    opacity: material.opacity ?? 1,
    transparent: Boolean(material.transparent),
    alphaTest: material.alphaTest ?? 0,
    side: material.side,
    vertexColors: Boolean(material.vertexColors),
    flatShading: Boolean(material.flatShading),
    normalScale: material.normalScale?.toArray?.() ?? null,
    maps: TEXTURE_SLOTS.map((slot) => material[slot]?.uuid ?? null),
  });
}

function samplerSignature(texture) {
  return JSON.stringify({
    colorSpace: texture.colorSpace,
    channel: texture.channel ?? 0,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    minFilter: texture.minFilter,
    magFilter: texture.magFilter,
    anisotropy: texture.anisotropy,
    flipY: texture.flipY,
    premultiplyAlpha: texture.premultiplyAlpha,
    offset: texture.offset?.toArray?.() ?? [0, 0],
    repeat: texture.repeat?.toArray?.() ?? [1, 1],
    center: texture.center?.toArray?.() ?? [0, 0],
    rotation: texture.rotation ?? 0,
  });
}

function imageDimensions(texture) {
  const image = texture?.image;
  return {
    width: image?.width ?? image?.videoWidth ?? 0,
    height: image?.height ?? image?.videoHeight ?? 0,
  };
}

async function texturePixelHash(texture) {
  const image = texture?.image;
  const { width, height } = imageDimensions(texture);
  if (!image || !width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels.buffer.slice(0));
    const bytes = new Uint8Array(digest);
    return `${width}x${height}:${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  } catch (error) {
    console.warn('[gluestack] texture content audit skipped', texture.name, error);
    return null;
  }
}

async function duplicateTextureGroups(editor) {
  const byContent = new Map();
  for (const texture of collectTextures(editor)) {
    const hash = await texturePixelHash(texture);
    if (!hash) continue;
    if (!byContent.has(hash)) byContent.set(hash, []);
    byContent.get(hash).push(texture);
  }
  const groups = [];
  for (const [hash, textures] of byContent) {
    if (textures.length < 2) continue;
    const safeBuckets = new Map();
    for (const texture of textures) {
      const key = samplerSignature(texture);
      if (!safeBuckets.has(key)) safeBuckets.set(key, []);
      safeBuckets.get(key).push(texture);
    }
    groups.push({
      hash,
      textures,
      safeMergeGroups: [...safeBuckets.values()].filter((items) => items.length > 1),
    });
  }
  return groups;
}

function unusedMaterialSlots(mesh) {
  const materials = materialsOf(mesh);
  if (materials.length <= 1) return [];
  const used = new Set((mesh.geometry?.groups ?? []).map((group) => Number(group.materialIndex ?? 0)));
  return materials.map((_material, index) => index).filter((index) => !used.has(index));
}

function alphaRiskMaterials(editor) {
  return collectMaterials(editor).filter((material) =>
    material.transparent
    || material.alphaMap
    || (material.opacity ?? 1) < 0.999
    || (material.alphaTest ?? 0) > 0,
  );
}

function vertexMergePreview(editor) {
  let meshes = 0;
  let before = 0;
  let after = 0;
  const details = [];
  editor.modelRoot.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.geometry?.getAttribute('position')) return;
    const sourceCount = mesh.geometry.getAttribute('position').count;
    let clone = mesh.geometry.clone();
    try {
      const merged = mergeVertices(clone, 1e-5);
      if (merged !== clone) clone.dispose();
      clone = merged;
      const mergedCount = clone.getAttribute('position')?.count ?? sourceCount;
      meshes += 1;
      before += sourceCount;
      after += mergedCount;
      if (mergedCount < sourceCount) details.push(`${mesh.name || 'Mesh'} ${sourceCount}→${mergedCount}`);
    } catch (error) {
      console.warn('[gluestack] vertex merge preview failed', mesh.name, error);
    } finally {
      clone?.dispose?.();
    }
  });
  return { meshes, before, after, saved: Math.max(0, before - after), details };
}

function duplicateMaterialGroups(editor) {
  const groups = new Map();
  for (const material of collectMaterials(editor)) {
    const key = materialSignature(material);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(material);
  }
  return [...groups.values()].filter((items) => items.length > 1);
}

export async function buildCleanupAudit(editor) {
  const vertexMerge = vertexMergePreview(editor);
  const duplicateMaterials = duplicateMaterialGroups(editor);
  const textureDuplicates = await duplicateTextureGroups(editor);
  const alphaMaterials = alphaRiskMaterials(editor);
  const emptyMeshes = [];
  const unusedSlots = [];
  editor.modelRoot.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const count = mesh.geometry?.getAttribute('position')?.count ?? 0;
    if (count < 3) emptyMeshes.push(mesh.name || 'Unnamed');
    const unused = unusedMaterialSlots(mesh);
    if (unused.length) unusedSlots.push({ mesh: mesh.name || 'Unnamed', slots: unused });
  });

  return {
    vertexMerge,
    duplicateMaterials,
    textureDuplicates,
    safeTextureMergeGroups: textureDuplicates.reduce((sum, group) => sum + group.safeMergeGroups.length, 0),
    alphaMaterials,
    emptyMeshes,
    unusedSlots,
  };
}

export function installCleanupAudit({ editor, gameReady }) {
  const panel = gameReady?.panel;
  const controller = gameReady?.controller;
  if (!editor || !panel || !controller || controller.__cleanupAudit) return controller?.__cleanupAudit ?? null;

  const card = document.createElement('div');
  card.className = 'game-ready-card cleanup-audit-card';
  card.innerHTML = `
    <div class="game-ready-title"><i data-lucide="list-checks"></i><span>Cleanup Preview</span></div>
    <div class="game-ready-note">Dry-run: ничего не меняет. Показывает, что можно безопасно объединить/почистить до Optimize.</div>
    <button type="button" class="game-ready-button" data-cleanup-audit><i data-lucide="scan-search"></i><span>Run Cleanup Audit</span></button>
    <pre class="game-ready-report cleanup-audit-report" data-cleanup-report>Not run</pre>`;
  panel.appendChild(card);

  const output = card.querySelector('[data-cleanup-report]');
  async function run() {
    const button = card.querySelector('[data-cleanup-audit]');
    button.disabled = true;
    output.textContent = 'Scanning…';
    try {
      const report = await buildCleanupAudit(editor);
      const duplicateTextures = report.textureDuplicates.reduce((sum, group) => sum + group.textures.length, 0);
      output.textContent = [
        `Vertex merge: ${report.vertexMerge.before.toLocaleString()} → ${report.vertexMerge.after.toLocaleString()} (${report.vertexMerge.saved.toLocaleString()} duplicate position vertices)`,
        `Duplicate material groups: ${report.duplicateMaterials.length}`,
        `Duplicate texture-content groups: ${report.textureDuplicates.length} (${duplicateTextures} texture objects)`,
        `Sampler-compatible texture merge groups: ${report.safeTextureMergeGroups}`,
        `Alpha/transparency protected materials: ${report.alphaMaterials.length}`,
        `Empty meshes: ${report.emptyMeshes.length}`,
        `Meshes with unused material slots: ${report.unusedSlots.length}`,
      ].join('\n');
      controller.status('Cleanup Preview: готово · сцена не изменена');
      console.groupCollapsed('[gluestack] Cleanup Preview');
      console.log(report);
      console.groupEnd();
      return report;
    } catch (error) {
      output.textContent = `Audit failed: ${error.message || error}`;
      controller.status(`Cleanup Preview: ${error.message || error}`);
      throw error;
    } finally {
      button.disabled = false;
    }
  }

  card.querySelector('[data-cleanup-audit]').addEventListener('click', run);
  const api = { run, card };
  controller.__cleanupAudit = api;
  refreshIcons();
  return api;
}
