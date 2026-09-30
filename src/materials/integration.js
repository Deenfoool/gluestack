import * as THREE from 'three';
import { refreshIcons } from '../ui.js';
import { disposeTextureIfUnreferenced } from '../runtime/resource-ownership.js';

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];

function materialsOf(mesh) {
  if (!mesh?.isMesh) return [];
  return Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
}

function materialOf(mesh, slot = 0) {
  const materials = materialsOf(mesh);
  return materials[Math.max(0, Math.min(slot, materials.length - 1))] ?? null;
}

function ensureStandardMaterial(mesh, slot = 0) {
  let material = materialOf(mesh, slot);
  if (material?.isMeshStandardMaterial) return material;
  const old = material;
  material = new THREE.MeshStandardMaterial({
    color: old?.color?.clone?.() ?? new THREE.Color(0xb8b8b8),
    map: old?.map ?? null,
    transparent: old?.transparent ?? false,
    opacity: old?.opacity ?? 1,
    side: old?.side ?? THREE.FrontSide,
    metalness: Number.isFinite(old?.metalness) ? old.metalness : 0,
    roughness: Number.isFinite(old?.roughness) ? old.roughness : 0.58,
    emissive: old?.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveIntensity: Number.isFinite(old?.emissiveIntensity) ? old.emissiveIntensity : 1,
  });
  material.name = old?.name || `Material ${slot + 1}`;
  if (Array.isArray(mesh.material)) mesh.material[slot] = material;
  else mesh.material = material;
  return material;
}

function loadTexture(file, colorTexture = false) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
      texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.userData.sourceName = file.name;
      URL.revokeObjectURL(url);
      resolve(texture);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Не удалось прочитать ${file.name}`));
    };
    image.src = url;
  });
}

export function installMaterialPanel({ editor }) {
  const propertiesContent = document.querySelector('.properties-content');
  const tabs = [...document.querySelectorAll('.property-tab')];
  const materialTab = tabs.find((button) => button.title?.startsWith('Material')) ?? tabs[2];
  if (!propertiesContent || !materialTab) return null;

  materialTab.disabled = false;
  materialTab.dataset.propertyTab = 'material';
  materialTab.title = 'Material';

  const panel = document.createElement('div');
  panel.id = 'material-properties';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="material-card">
      <div class="material-title"><i data-lucide="layers-3"></i><span>Material Slot</span></div>
      <label class="material-row"><span>Slot</span><select data-material-slot></select></label>
      <div class="material-note" data-material-slot-info>1 material</div>
    </div>
    <div class="material-card">
      <div class="material-title"><i data-lucide="circle-dot"></i><span>Principled PBR</span></div>
      <label class="material-row"><span>Base Color</span><input data-mat="color" type="color" value="#b8b8b8" /></label>
      <label class="material-row"><span>Metallic</span><input data-mat="metalness" type="range" min="0" max="1" step="0.01" value="0" /></label>
      <label class="material-row"><span>Roughness</span><input data-mat="roughness" type="range" min="0" max="1" step="0.01" value="0.58" /></label>
      <label class="material-row"><span>Opacity</span><input data-mat="opacity" type="range" min="0" max="1" step="0.01" value="1" /></label>
      <label class="material-row"><span>Emissive</span><input data-mat="emissive" type="color" value="#000000" /></label>
      <label class="material-row"><span>Emission</span><input data-mat="emissiveIntensity" type="number" min="0" step="0.1" value="1" /></label>
    </div>
    <div class="material-card">
      <div class="material-title"><i data-lucide="image"></i><span>Textures</span></div>
      <label class="texture-row"><span>Base Color</span><input data-texture="map" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label class="texture-row"><span>Normal</span><input data-texture="normalMap" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label class="texture-row"><span>Roughness</span><input data-texture="roughnessMap" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label class="texture-row"><span>Metallic</span><input data-texture="metalnessMap" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label class="texture-row"><span>AO</span><input data-texture="aoMap" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label class="texture-row"><span>Emissive</span><input data-texture="emissiveMap" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <button type="button" class="material-button" data-material-action="clear-textures"><i data-lucide="eraser"></i><span>Clear Slot Textures</span></button>
    </div>
    <div class="material-card">
      <div class="material-title"><i data-lucide="move-diagonal-2"></i><span>Texture Transform</span></div>
      <div class="material-vector"><span>Offset</span><label>X <input data-tex-transform="offset.x" type="number" step="0.01" value="0" /></label><label>Y <input data-tex-transform="offset.y" type="number" step="0.01" value="0" /></label></div>
      <div class="material-vector"><span>Scale</span><label>X <input data-tex-transform="repeat.x" type="number" step="0.1" value="1" /></label><label>Y <input data-tex-transform="repeat.y" type="number" step="0.1" value="1" /></label></div>
      <label class="material-row"><span>Rotation °</span><input data-tex-rotation type="number" step="1" value="0" /></label>
      <div class="material-note">Transform применяется только к картам выбранного material slot и экспортируется в GLB.</div>
    </div>`;
  propertiesContent.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .material-card{border-top:1px solid #444;padding:8px 0}.material-card:first-child{border-top:0;padding-top:0}.material-title{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:8px}.material-row,.texture-row{display:grid;grid-template-columns:82px minmax(0,1fr);gap:6px;align-items:center;margin:6px 0}.material-row input[type=number],.material-vector input,.material-row select{width:100%;min-width:0;height:24px;background:#1f1f1f;color:#eee;border:1px solid #4a4a4a;border-radius:3px;padding:2px 5px}.material-row input[type=color]{width:100%;height:25px;border:1px solid #4a4a4a;background:#1f1f1f;border-radius:3px}.material-row input[type=range]{width:100%}.texture-row input{font-size:10px;min-width:0}.material-vector{display:grid;grid-template-columns:55px 1fr 1fr;gap:5px;align-items:center;margin:5px 0}.material-vector label{display:grid;grid-template-columns:12px 1fr;gap:3px;align-items:center}.material-button{width:100%;min-height:28px;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:7px;border:1px solid #444;border-radius:3px;background:#303030;color:#ddd}.material-button:hover{background:#454545}.material-note{margin-top:7px;color:#999;font-size:11px;line-height:1.35}`;
  document.head.appendChild(style);

  let visible = false;
  let slotIndex = 0;
  const slotSelect = panel.querySelector('[data-material-slot]');
  const slotInfo = panel.querySelector('[data-material-slot-info]');

  function refreshSlots(mesh = editor.selected) {
    const materials = materialsOf(mesh);
    if (!materials.length) {
      slotSelect.replaceChildren();
      slotInfo.textContent = 'No material';
      slotSelect.disabled = true;
      slotIndex = 0;
      return;
    }
    slotIndex = Math.max(0, Math.min(slotIndex, materials.length - 1));
    slotSelect.replaceChildren();
    materials.forEach((material, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${index + 1}: ${material?.name || material?.type || 'Material'}`;
      slotSelect.appendChild(option);
    });
    slotSelect.value = String(slotIndex);
    slotSelect.disabled = materials.length <= 1;
    const groups = mesh?.geometry?.groups?.filter((group) => group.materialIndex === slotIndex).length ?? 0;
    slotInfo.textContent = `${materials.length} material slot(s) · selected ${slotIndex + 1}${groups ? ` · groups ${groups}` : ''}`;
  }

  function current() {
    const mesh = editor.selected;
    if (!mesh?.isMesh) return null;
    refreshSlots(mesh);
    return ensureStandardMaterial(mesh, slotIndex);
  }

  function refresh() {
    const mesh = editor.selected;
    if (!mesh?.isMesh) return;
    refreshSlots(mesh);
    const material = ensureStandardMaterial(mesh, slotIndex);
    if (!material) return;
    panel.querySelector('[data-mat="color"]').value = `#${material.color.getHexString()}`;
    panel.querySelector('[data-mat="metalness"]').value = material.metalness;
    panel.querySelector('[data-mat="roughness"]').value = material.roughness;
    panel.querySelector('[data-mat="opacity"]').value = material.opacity;
    panel.querySelector('[data-mat="emissive"]').value = `#${material.emissive.getHexString()}`;
    panel.querySelector('[data-mat="emissiveIntensity"]').value = material.emissiveIntensity;
    const texture = TEXTURE_KEYS.map((key) => material[key]).find(Boolean) ?? null;
    panel.querySelectorAll('[data-tex-transform]').forEach((input) => {
      const [group, axis] = input.dataset.texTransform.split('.');
      input.value = texture?.[group]?.[axis] ?? (group === 'repeat' ? 1 : 0);
    });
    panel.querySelector('[data-tex-rotation]').value = THREE.MathUtils.radToDeg(texture?.rotation ?? 0);
  }

  function show() {
    visible = true;
    panel.hidden = false;
    refresh();
  }
  function hide() { visible = false; panel.hidden = true; }

  slotSelect.addEventListener('change', () => {
    slotIndex = Math.max(0, Number(slotSelect.value) || 0);
    refresh();
  });

  document.querySelectorAll('[data-property-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.propertyTab === 'material') show();
      else hide();
    });
  });

  panel.querySelectorAll('[data-mat]').forEach((input) => {
    input.addEventListener('input', () => {
      const material = current();
      if (!material) return;
      editor.beginHistory(`Material slot ${slotIndex + 1}`);
      const key = input.dataset.mat;
      if (key === 'color' || key === 'emissive') material[key].set(input.value);
      else material[key] = Number(input.value);
      if (key === 'opacity') material.transparent = material.opacity < 0.999;
      material.needsUpdate = true;
    });
    input.addEventListener('change', () => editor.commitHistory());
  });

  panel.querySelectorAll('[data-texture]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      const material = current();
      const mesh = editor.selected;
      if (!file || !material || !mesh?.isMesh) return;
      try {
        editor.checkpoint(`Texture ${input.dataset.texture} · slot ${slotIndex + 1}`);
        const key = input.dataset.texture;
        const texture = await loadTexture(file, key === 'map' || key === 'emissiveMap');
        const oldTexture = material[key];
        material[key] = texture;
        disposeTextureIfUnreferenced(editor, oldTexture);
        if (key === 'aoMap' && !mesh.geometry.getAttribute('uv1')) {
          const uv = mesh.geometry.getAttribute('uv');
          if (uv) mesh.geometry.setAttribute('uv1', uv.clone());
        }
        material.needsUpdate = true;
        editor.events.onStatus(`${file.name} → slot ${slotIndex + 1} / ${key}`);
        window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture, key, slot: slotIndex } }));
      } catch (error) {
        editor.events.onStatus(error.message || String(error));
      } finally {
        input.value = '';
      }
    });
  });

  panel.querySelector('[data-material-action="clear-textures"]').addEventListener('click', () => {
    const material = current();
    const mesh = editor.selected;
    if (!material || !mesh?.isMesh) return;
    editor.checkpoint(`Clear textures · slot ${slotIndex + 1}`);
    const detached = [];
    for (const key of TEXTURE_KEYS) {
      if (material[key]) detached.push(material[key]);
      material[key] = null;
    }
    detached.forEach((texture) => disposeTextureIfUnreferenced(editor, texture));
    material.needsUpdate = true;
    editor.events.onStatus(`Текстуры material slot ${slotIndex + 1} очищены`);
    window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture: null, key: 'map', slot: slotIndex } }));
  });

  function applyTextureTransform() {
    const material = current();
    if (!material) return;
    const values = Object.fromEntries([...panel.querySelectorAll('[data-tex-transform]')].map((input) => [input.dataset.texTransform, Number(input.value)]));
    const rotation = THREE.MathUtils.degToRad(Number(panel.querySelector('[data-tex-rotation]').value) || 0);
    for (const key of TEXTURE_KEYS) {
      const texture = material[key];
      if (!texture) continue;
      texture.offset.set(values['offset.x'] || 0, values['offset.y'] || 0);
      texture.repeat.set(values['repeat.x'] || 1, values['repeat.y'] || 1);
      texture.center.set(0.5, 0.5);
      texture.rotation = rotation;
      texture.needsUpdate = true;
    }
  }
  panel.querySelectorAll('[data-tex-transform],[data-tex-rotation]').forEach((input) => {
    input.addEventListener('focus', () => editor.beginHistory(`Texture transform · slot ${slotIndex + 1}`));
    input.addEventListener('input', applyTextureTransform);
    input.addEventListener('change', () => editor.commitHistory());
  });

  const previewButtons = [...document.querySelectorAll('.viewport-header .header-icon')];
  const materialPreview = previewButtons[1];
  if (materialPreview) {
    materialPreview.disabled = false;
    materialPreview.title = 'Material Preview';
    materialPreview.addEventListener('click', () => {
      previewButtons.forEach((button) => button.classList.remove('active'));
      materialPreview.classList.add('active');
      editor.scene.background.set(0x2f2f2f);
      editor.renderer.toneMappingExposure = 1.08;
      editor.events.onStatus('Material Preview');
    });
    previewButtons[0]?.addEventListener('click', () => {
      previewButtons.forEach((button) => button.classList.remove('active'));
      previewButtons[0].classList.add('active');
      editor.scene.background.set(0x393939);
      editor.renderer.toneMappingExposure = 1;
      editor.events.onStatus('Solid');
    });
  }

  window.addEventListener('gluestack:texture-changed', (event) => {
    if (visible && event.detail?.mesh === editor.selected && (event.detail?.slot === undefined || event.detail.slot === slotIndex)) refresh();
  });

  refreshIcons();
  return {
    panel,
    show,
    hide,
    refresh,
    get selectedSlot() { return slotIndex; },
  };
}
