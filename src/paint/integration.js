import * as THREE from 'three';
import { refreshIcons } from '../ui.js';
import { disposeTextureIfUnreferenced } from '../runtime/resource-ownership.js';

const CHANNELS = {
  map: { label: 'Base Color', colorSpace: THREE.SRGBColorSpace, fill: '#ffffff', mode: 'color' },
  roughnessMap: { label: 'Roughness', colorSpace: THREE.NoColorSpace, fill: '#ffffff', mode: 'scalar' },
  metalnessMap: { label: 'Metallic', colorSpace: THREE.NoColorSpace, fill: '#000000', mode: 'scalar' },
  normalMap: { label: 'Normal', colorSpace: THREE.NoColorSpace, fill: '#8080ff', mode: 'color' },
  emissiveMap: { label: 'Emissive', colorSpace: THREE.SRGBColorSpace, fill: '#000000', mode: 'color' },
};

function getMaterial(mesh, slot = 0) {
  const material = Array.isArray(mesh?.material) ? mesh.material[slot] : mesh?.material;
  return material?.isMeshStandardMaterial ? material : null;
}

function canvasFromTexture(texture, size = 1024, fill = '#ffffff') {
  const canvas = document.createElement('canvas');
  const image = texture?.image;
  canvas.width = image?.width || size;
  canvas.height = image?.height || size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  else {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function copyTextureSettings(target, source, colorSpace) {
  if (!source) {
    target.colorSpace = colorSpace;
    target.wrapS = THREE.RepeatWrapping;
    target.wrapT = THREE.RepeatWrapping;
    return target;
  }
  target.name = source.name;
  target.mapping = source.mapping;
  target.channel = source.channel;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.flipY = source.flipY;
  target.unpackAlignment = source.unpackAlignment;
  target.colorSpace = source.colorSpace || colorSpace;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.userData = structuredClone(source.userData ?? {});
  target.needsUpdate = true;
  return target;
}

function paintTextureFromCanvas(canvas, source, colorSpace) {
  return copyTextureSettings(new THREE.CanvasTexture(canvas), source, colorSpace);
}

function scalarColor(value) {
  const channel = Math.round(THREE.MathUtils.clamp(Number(value) || 0, 0, 1) * 255);
  return `rgb(${channel},${channel},${channel})`;
}

export function installTexturePaint({ editor, editMode, knifeTool, materials = null }) {
  const tabs = document.querySelector('.workspace-tabs');
  const viewport = document.querySelector('#viewport');
  if (!tabs || !viewport) return null;

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'workspace-tab';
  tab.dataset.workspace = 'paint';
  tab.textContent = 'Texture Paint';
  const spacer = tabs.querySelector('.workspace-spacer');
  tabs.insertBefore(tab, spacer);

  const panel = document.createElement('div');
  panel.className = 'paint-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="paint-panel-title"><i data-lucide="brush"></i><span>Texture Paint</span></div>
    <div class="paint-slot" data-paint-slot>Material slot 1</div>
    <label><span>Channel</span><select data-paint-channel>
      <option value="map">Base Color</option>
      <option value="roughnessMap">Roughness</option>
      <option value="metalnessMap">Metallic</option>
      <option value="normalMap">Normal</option>
      <option value="emissiveMap">Emissive</option>
    </select></label>
    <label data-paint-color-row><span>Color</span><input data-paint="color" type="color" value="#d26a36" /></label>
    <label data-paint-value-row hidden><span>Value</span><input data-paint="value" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
    <label><span>Size</span><input data-paint="size" type="range" min="2" max="160" step="1" value="36" /></label>
    <label><span>Strength</span><input data-paint="strength" type="range" min="0.05" max="1" step="0.05" value="1" /></label>
    <button type="button" data-paint-action="clear"><i data-lucide="paint-bucket"></i><span>Fill Channel</span></button>`;
  viewport.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .paint-panel{position:absolute;z-index:14;top:10px;left:10px;width:225px;padding:9px;background:rgba(35,35,35,.96);border:1px solid #555;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.3)}.paint-panel-title{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:5px}.paint-slot{color:#aaa;font-size:11px;margin-bottom:8px}.paint-panel label{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:6px;margin:6px 0}.paint-panel select{width:100%;height:25px;background:#1f1f1f;color:#eee;border:1px solid #4a4a4a;border-radius:3px}.paint-panel input[type=color]{width:100%;height:25px;background:#1f1f1f;border:1px solid #4a4a4a}.paint-panel input[type=range]{width:100%}.paint-panel button{width:100%;min-height:28px;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;border:1px solid #494949;border-radius:3px;background:#303030;color:#ddd}.paint-panel button:hover{background:#454545}`;
  document.head.appendChild(style);

  let active = false;
  let painting = false;
  let mesh = null;
  let material = null;
  let materialSlot = 0;
  let channelKey = 'map';
  let paintCanvas = null;
  let paintCtx = null;
  let texture = null;

  const channelSelect = panel.querySelector('[data-paint-channel]');
  const colorInput = panel.querySelector('[data-paint="color"]');
  const valueInput = panel.querySelector('[data-paint="value"]');
  const colorRow = panel.querySelector('[data-paint-color-row]');
  const valueRow = panel.querySelector('[data-paint-value-row]');

  function channelConfig() { return CHANNELS[channelKey] ?? CHANNELS.map; }

  function updateChannelUI() {
    const config = channelConfig();
    colorRow.hidden = config.mode !== 'color';
    valueRow.hidden = config.mode !== 'scalar';
    if (channelKey === 'normalMap' && colorInput.value.toLowerCase() === '#d26a36') colorInput.value = '#8080ff';
    if (channelKey === 'emissiveMap' && colorInput.value.toLowerCase() === '#8080ff') colorInput.value = '#ff6a36';
  }

  function brushColor() {
    return channelConfig().mode === 'scalar' ? scalarColor(valueInput.value) : colorInput.value;
  }

  function activateChannel({ checkpoint = true } = {}) {
    if (!material) return false;
    const config = channelConfig();
    if (checkpoint) editor.checkpoint(`Prepare texture paint · ${config.label} · slot ${materialSlot + 1}`);
    const old = material[channelKey];
    paintCanvas = canvasFromTexture(old, 1024, config.fill);
    paintCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
    texture = paintTextureFromCanvas(paintCanvas, old, config.colorSpace);
    material[channelKey] = texture;
    if (channelKey === 'emissiveMap' && material.emissive?.getHex?.() === 0) material.emissive.set(0xffffff);
    material.needsUpdate = true;
    disposeTextureIfUnreferenced(editor, old);
    window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture, key: channelKey, slot: materialSlot } }));
    editor.events.onStatus(`Texture Paint · ${config.label} · slot ${materialSlot + 1}`);
    return true;
  }

  function prepare() {
    mesh = editor.selected;
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh) {
      editor.events.onStatus('Texture Paint: выберите обычный Mesh');
      return false;
    }
    if (!mesh.geometry.getAttribute('uv')) {
      editor.events.onStatus('Texture Paint: у Mesh нет UV — сначала откройте UV Editing');
      return false;
    }
    const slotCount = Array.isArray(mesh.material) ? mesh.material.length : mesh.material ? 1 : 0;
    materialSlot = Math.max(0, Math.min(materials?.selectedSlot ?? 0, Math.max(0, slotCount - 1)));
    material = getMaterial(mesh, materialSlot);
    if (!material) {
      editor.events.onStatus(`Texture Paint: material slot ${materialSlot + 1} должен быть MeshStandardMaterial`);
      return false;
    }
    panel.querySelector('[data-paint-slot]').textContent = `Material slot ${materialSlot + 1}${material.name ? ` · ${material.name}` : ''}`;
    return activateChannel({ checkpoint: true });
  }

  function enter() {
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
    channelKey = channelSelect.value || 'map';
    updateChannelUI();
    if (!prepare()) {
      document.querySelector('[data-workspace="layout"]')?.click();
      return false;
    }
    active = true;
    panel.hidden = false;
    editor.transform.detach();
    editor.events.onStatus(`Texture Paint · ${channelConfig().label} · slot ${materialSlot + 1} · ЛКМ рисовать · MMB навигация`);
    refreshIcons();
    return true;
  }

  function leave() {
    if (!active) return;
    active = false;
    painting = false;
    panel.hidden = true;
    editor.orbit.enabled = true;
    if (editor.selected) editor.transform.attach(editor.selected);
  }

  tabs.addEventListener('click', (event) => {
    const selectedTab = event.target.closest('.workspace-tab');
    if (!selectedTab || selectedTab.disabled) return;
    if (selectedTab.dataset.workspace === 'paint') enter();
    else leave();
  }, { capture: true });

  channelSelect.addEventListener('change', () => {
    channelKey = channelSelect.value || 'map';
    updateChannelUI();
    if (active) activateChannel({ checkpoint: true });
  });

  function transformedUV(uv) {
    const next = uv.clone();
    if (texture) texture.transformUv(next);
    return next;
  }

  function hitMatchesSlot(hit) {
    if (!Array.isArray(mesh?.material)) return true;
    return (hit?.face?.materialIndex ?? 0) === materialSlot;
  }

  function paintAt(event) {
    if (!active || !painting || !mesh || !paintCtx) return;
    const rect = editor.renderer.domElement.getBoundingClientRect();
    editor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    editor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    editor.raycaster.setFromCamera(editor.pointer, editor.camera);
    const hit = editor.raycaster.intersectObject(mesh, false)[0];
    if (!hit?.uv || !hitMatchesSlot(hit)) return;
    const uv = transformedUV(hit.uv);
    const x = uv.x * paintCanvas.width;
    const y = (1 - uv.y) * paintCanvas.height;
    const radius = Number(panel.querySelector('[data-paint="size"]').value);
    const strength = Number(panel.querySelector('[data-paint="strength"]').value);
    const color = brushColor();
    const gradient = paintCtx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.72, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    paintCtx.save();
    paintCtx.globalCompositeOperation = 'source-over';
    paintCtx.globalAlpha = THREE.MathUtils.clamp(strength, 0.05, 1);
    paintCtx.fillStyle = gradient;
    paintCtx.beginPath();
    paintCtx.arc(x, y, radius, 0, Math.PI * 2);
    paintCtx.fill();
    paintCtx.restore();
    texture.needsUpdate = true;
  }

  editor.renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.beginHistory(`Texture paint stroke · ${channelConfig().label} · slot ${materialSlot + 1}`);
    painting = true;
    editor.orbit.enabled = false;
    paintAt(event);
  }, true);
  editor.renderer.domElement.addEventListener('pointermove', (event) => {
    if (!active || !painting) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    paintAt(event);
  }, true);
  window.addEventListener('pointerup', () => {
    if (!painting) return;
    painting = false;
    editor.orbit.enabled = true;
    editor.commitHistory();
    window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture, key: channelKey, slot: materialSlot } }));
  }, true);

  panel.querySelector('[data-paint-action="clear"]').addEventListener('click', () => {
    if (!paintCtx) return;
    editor.checkpoint(`Texture paint fill · ${channelConfig().label} · slot ${materialSlot + 1}`);
    paintCtx.fillStyle = brushColor();
    paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
    texture.needsUpdate = true;
    window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture, key: channelKey, slot: materialSlot } }));
  });

  const previousSelection = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelection(...args);
    if (active && editor.selected !== mesh) {
      leave();
      editor.events.onStatus('Texture Paint завершён: выбран другой объект');
    }
  };

  refreshIcons();
  return {
    tab,
    panel,
    enter,
    leave,
    get active() { return active; },
    get materialSlot() { return materialSlot; },
    get channel() { return channelKey; },
  };
}
