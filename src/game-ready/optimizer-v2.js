import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeGeometryIfUnreferenced, disposeTextureIfUnreferenced, TEXTURE_SLOTS } from '../runtime/resource-ownership.js';
import { refreshIcons } from '../ui.js';

const ORM_SLOTS = ['aoMap', 'roughnessMap', 'metalnessMap'];

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : mesh.material ? [mesh.material] : [];
}

function allMaterials(editor) {
  const result = new Set();
  editor.modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    materialsOf(object).forEach((material) => result.add(material));
  });
  return [...result];
}

function allTextures(editor) {
  const result = new Set();
  for (const material of allMaterials(editor)) {
    for (const slot of TEXTURE_SLOTS) if (material?.[slot]?.isTexture) result.add(material[slot]);
  }
  return [...result];
}

function imageSize(texture) {
  const image = texture?.image;
  return {
    width: image?.width ?? image?.videoWidth ?? 0,
    height: image?.height ?? image?.videoHeight ?? 0,
  };
}

function textureBytes(texture) {
  const { width, height } = imageSize(texture);
  return width * height * 4;
}

function copyTextureSettings(source, target) {
  target.name = source.name;
  target.colorSpace = source.colorSpace;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.flipY = source.flipY;
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  if (!source.matrixAutoUpdate) target.matrix.copy(source.matrix);
  target.needsUpdate = true;
  return target;
}

function canvasFromImage(image, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function scaledSize(width, height, maxSize) {
  if (!width || !height) return { width, height };
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function replaceTextureReferences(editor, oldTexture, newTexture) {
  let count = 0;
  editor.modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of materialsOf(object)) {
      for (const slot of TEXTURE_SLOTS) {
        if (material?.[slot] !== oldTexture) continue;
        material[slot] = newTexture;
        material.needsUpdate = true;
        count += 1;
      }
    }
  });
  return count;
}

function textureTransformKey(texture) {
  if (!texture) return null;
  return JSON.stringify({
    offset: texture.offset?.toArray?.() ?? [0, 0],
    repeat: texture.repeat?.toArray?.() ?? [1, 1],
    center: texture.center?.toArray?.() ?? [0, 0],
    rotation: texture.rotation ?? 0,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    flipY: texture.flipY,
    matrixAutoUpdate: texture.matrixAutoUpdate,
    matrix: texture.matrix?.toArray?.() ?? null,
  });
}

function ormCompatibility(material) {
  const maps = ORM_SLOTS.map((slot) => material?.[slot]).filter((texture) => texture?.isTexture);
  if (maps.length < 2) return { ok: false, reason: 'нужно минимум 2 карты AO/Roughness/Metallic' };
  const keys = new Set(maps.map(textureTransformKey));
  if (keys.size > 1) return { ok: false, reason: 'карты используют разные UV transforms/wrap settings' };
  if (maps.some((texture) => !texture.image)) return { ok: false, reason: 'карта не имеет доступного image source' };
  return { ok: true, maps };
}

function readChannel(texture, width, height, channel) {
  if (!texture?.image) return null;
  const canvas = canvasFromImage(texture.image, width, height);
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const output = new Uint8Array(width * height);
  const offset = channel === 'r' ? 0 : channel === 'g' ? 1 : 2;
  for (let i = 0; i < output.length; i += 1) output[i] = data[i * 4 + offset];
  return output;
}

function packORMMaterial(material, maxSize) {
  const compatibility = ormCompatibility(material);
  if (!compatibility.ok) return { ok: false, reason: compatibility.reason };
  const maps = compatibility.maps;
  const maxWidth = Math.max(...maps.map((texture) => imageSize(texture).width));
  const maxHeight = Math.max(...maps.map((texture) => imageSize(texture).height));
  const size = scaledSize(maxWidth, maxHeight, maxSize);
  if (!size.width || !size.height) return { ok: false, reason: 'не удалось определить размер карт' };

  let ao;
  let roughness;
  let metallic;
  try {
    ao = readChannel(material.aoMap, size.width, size.height, 'r');
    roughness = readChannel(material.roughnessMap, size.width, size.height, 'g');
    metallic = readChannel(material.metalnessMap, size.width, size.height, 'b');
  } catch (error) {
    return { ok: false, reason: `canvas read failed: ${error.message || error}` };
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size.width, size.height);
  const roughnessDefault = Math.round(THREE.MathUtils.clamp(material.roughness ?? 1, 0, 1) * 255);
  const metallicDefault = Math.round(THREE.MathUtils.clamp(material.metalness ?? 0, 0, 1) * 255);
  for (let i = 0; i < size.width * size.height; i += 1) {
    image.data[i * 4] = ao?.[i] ?? 255;
    image.data[i * 4 + 1] = roughness?.[i] ?? roughnessDefault;
    image.data[i * 4 + 2] = metallic?.[i] ?? metallicDefault;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const reference = material.aoMap ?? material.roughnessMap ?? material.metalnessMap;
  const packed = copyTextureSettings(reference, new THREE.CanvasTexture(canvas));
  packed.name = `${material.name || 'Material'}_ORM`;
  packed.colorSpace = THREE.NoColorSpace;
  packed.needsUpdate = true;
  return { ok: true, texture: packed, oldMaps: maps, width: size.width, height: size.height };
}

function hasMorph(mesh) {
  return Boolean(mesh?.morphTargetInfluences?.length)
    || Object.values(mesh?.geometry?.morphAttributes ?? {}).some((items) => items?.length);
}

function duplicateTextureWarnings(editor) {
  const bySource = new Map();
  for (const texture of allTextures(editor)) {
    const image = texture.image;
    const source = image?.currentSrc || image?.src || image?.data?.src || '';
    if (!source) continue;
    const key = `${source}|${imageSize(texture).width}x${imageSize(texture).height}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(texture);
  }
  return [...bySource.values()].filter((items) => items.length > 1);
}

function preview(editor, maxTextureSize) {
  const textures = allTextures(editor);
  const currentBytes = textures.reduce((sum, texture) => sum + textureBytes(texture), 0);
  let resizedBytes = 0;
  let oversized = 0;
  for (const texture of textures) {
    const { width, height } = imageSize(texture);
    const target = scaledSize(width, height, maxTextureSize);
    resizedBytes += target.width * target.height * 4;
    if (Math.max(width, height) > maxTextureSize) oversized += 1;
  }
  const materials = allMaterials(editor);
  const ormPackable = materials.filter((material) => ormCompatibility(material).ok).length;
  let tangentCandidates = 0;
  editor.modelRoot.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || hasMorph(mesh)) return;
    const normalMapped = materialsOf(mesh).some((material) => material?.normalMap);
    if (normalMapped && mesh.geometry?.getAttribute('uv') && mesh.geometry?.getAttribute('normal') && !mesh.geometry?.getAttribute('tangent')) tangentCandidates += 1;
  });
  return {
    textures: textures.length,
    oversized,
    currentBytes,
    resizedBytes,
    savedBytes: Math.max(0, currentBytes - resizedBytes),
    ormPackable,
    tangentCandidates,
    duplicateTextureGroups: duplicateTextureWarnings(editor).length,
  };
}

export function installGameReadyOptimizerV2({ editor, gameReady }) {
  const controller = gameReady?.controller;
  const panel = gameReady?.panel;
  if (!editor || !controller || !panel || controller.__optimizerV2) return controller?.__optimizerV2 ?? null;

  const card = document.createElement('div');
  card.className = 'game-ready-card optimizer-v2-card';
  card.innerHTML = `
    <div class="game-ready-title"><i data-lucide="gauge"></i><span>Optimizer v2</span></div>
    <div class="optimizer-v2-grid">
      <label><span>Profile</span><select data-opt-profile><option value="web">Web</option><option value="generic" selected>Generic glTF</option><option value="godot">Godot</option><option value="unity">Unity</option></select></label>
      <label><span>Max texture</span><select data-opt-max-texture><option>512</option><option>1024</option><option selected>2048</option><option>4096</option></select></label>
    </div>
    <div class="optimizer-v2-actions">
      <button type="button" data-opt-action="preview">Preview</button>
      <button type="button" data-opt-action="resize">Resize Oversized</button>
      <button type="button" data-opt-action="orm">Pack ORM</button>
      <button type="button" data-opt-action="tangents">Generate Tangents</button>
    </div>
    <div class="game-ready-report" data-opt-report>Run Preview before applying texture changes.</div>`;
  panel.appendChild(card);

  const style = document.createElement('style');
  style.textContent = `
    .optimizer-v2-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.optimizer-v2-grid label{display:grid;grid-template-columns:1fr 86px;gap:5px;align-items:center;font-size:10px;color:#aaa}.optimizer-v2-grid select{height:24px;min-width:0;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px}.optimizer-v2-actions{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px}.optimizer-v2-actions button{min-height:27px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.optimizer-v2-actions button:hover{background:#484848}`;
  document.head.appendChild(style);

  const profileInput = card.querySelector('[data-opt-profile]');
  const maxTextureInput = card.querySelector('[data-opt-max-texture]');
  const output = card.querySelector('[data-opt-report]');

  function maxTexture() {
    return Math.max(128, Number(maxTextureInput.value) || 2048);
  }

  function applyProfile() {
    const presets = { web: 2048, generic: 4096, godot: 4096, unity: 4096 };
    maxTextureInput.value = String(presets[profileInput.value] ?? 2048);
    showPreview();
  }

  function showPreview() {
    const data = preview(editor, maxTexture());
    output.textContent = `Textures ${data.textures} · oversized ${data.oversized}\nTexture RAM ${(data.currentBytes / 1048576).toFixed(1)} → ${(data.resizedBytes / 1048576).toFixed(1)} MB · potential save ${(data.savedBytes / 1048576).toFixed(1)} MB\nORM packable ${data.ormPackable} material(s) · tangent candidates ${data.tangentCandidates} · duplicate source groups ${data.duplicateTextureGroups}`;
    return data;
  }

  function resizeOversized() {
    const limit = maxTexture();
    const textures = allTextures(editor).filter((texture) => {
      const { width, height } = imageSize(texture);
      return texture.image && Math.max(width, height) > limit;
    });
    if (!textures.length) {
      controller.status('Texture Resize: oversized textures отсутствуют');
      return false;
    }
    editor.checkpoint('Resize textures');
    let resized = 0;
    for (const texture of textures) {
      const { width, height } = imageSize(texture);
      const size = scaledSize(width, height, limit);
      try {
        const canvas = canvasFromImage(texture.image, size.width, size.height);
        const next = copyTextureSettings(texture, new THREE.CanvasTexture(canvas));
        replaceTextureReferences(editor, texture, next);
        disposeTextureIfUnreferenced(editor, texture);
        resized += 1;
      } catch (error) {
        console.warn('[gluestack] texture resize failed', texture.name, error);
      }
    }
    editor.events.onStructure();
    editor.events.onTransform(editor.selected);
    controller.status(`Texture Resize · ${resized}/${textures.length}`);
    showPreview();
    return resized > 0;
  }

  function packORM() {
    const materials = allMaterials(editor);
    const candidates = materials.filter((material) => ormCompatibility(material).ok);
    if (!candidates.length) {
      controller.status('ORM Pack: совместимых материалов нет');
      return false;
    }
    editor.checkpoint('Pack ORM textures');
    let packedCount = 0;
    for (const material of candidates) {
      const result = packORMMaterial(material, maxTexture());
      if (!result.ok) continue;
      const oldMaps = new Set(result.oldMaps);
      material.aoMap = result.texture;
      material.roughnessMap = result.texture;
      material.metalnessMap = result.texture;
      material.needsUpdate = true;
      oldMaps.forEach((texture) => disposeTextureIfUnreferenced(editor, texture));
      packedCount += 1;
    }
    editor.events.onStructure();
    editor.events.onTransform(editor.selected);
    controller.status(`ORM Pack · ${packedCount}/${candidates.length} material(s)`);
    showPreview();
    return packedCount > 0;
  }

  function generateTangents() {
    const meshes = [];
    editor.modelRoot.traverse((mesh) => {
      if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || hasMorph(mesh)) return;
      if (!materialsOf(mesh).some((material) => material?.normalMap)) return;
      const geometry = mesh.geometry;
      if (!geometry?.getAttribute('uv') || !geometry.getAttribute('normal') || geometry.getAttribute('tangent')) return;
      meshes.push(mesh);
    });
    if (!meshes.length) {
      controller.status('Tangents: кандидатов нет');
      return false;
    }
    editor.checkpoint('Generate tangents');
    let generated = 0;
    for (const mesh of meshes) {
      const source = mesh.geometry;
      let geometry = source.clone();
      try {
        if (!geometry.index) {
          const indexed = mergeVertices(geometry, 1e-6);
          if (indexed !== geometry) geometry.dispose();
          geometry = indexed;
        }
        geometry.computeTangents();
        if (!geometry.getAttribute('tangent')) throw new Error('computeTangents did not create attribute');
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        mesh.geometry = geometry;
        disposeGeometryIfUnreferenced(editor, source);
        generated += 1;
      } catch (error) {
        geometry?.dispose?.();
        console.warn('[gluestack] tangent generation failed', mesh.name, error);
      }
    }
    editor.refreshSelectionVisuals();
    editor.events.onStructure();
    editor.events.onTransform(editor.selected);
    controller.status(`Tangents · ${generated}/${meshes.length} mesh(es)`);
    showPreview();
    return generated > 0;
  }

  profileInput.addEventListener('change', applyProfile);
  card.querySelector('[data-opt-action="preview"]').addEventListener('click', showPreview);
  card.querySelector('[data-opt-action="resize"]').addEventListener('click', resizeOversized);
  card.querySelector('[data-opt-action="orm"]').addEventListener('click', packORM);
  card.querySelector('[data-opt-action="tangents"]').addEventListener('click', generateTangents);

  const api = { preview: showPreview, resizeOversized, packORM, generateTangents, card };
  controller.__optimizerV2 = api;
  refreshIcons();
  return api;
}
