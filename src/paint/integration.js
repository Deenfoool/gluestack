import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

function getMaterial(mesh) {
  const material = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
  return material?.isMeshStandardMaterial ? material : null;
}

function canvasFromTexture(texture, size = 1024) {
  const canvas = document.createElement('canvas');
  const image = texture?.image;
  canvas.width = image?.width || size;
  canvas.height = image?.height || size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export function installTexturePaint({ editor, editMode, knifeTool }) {
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
    <label><span>Color</span><input data-paint="color" type="color" value="#d26a36" /></label>
    <label><span>Size</span><input data-paint="size" type="range" min="2" max="160" step="1" value="36" /></label>
    <label><span>Strength</span><input data-paint="strength" type="range" min="0.05" max="1" step="0.05" value="1" /></label>
    <button type="button" data-paint-action="clear"><i data-lucide="eraser"></i><span>Fill White</span></button>`;
  viewport.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .paint-panel{position:absolute;z-index:14;top:10px;left:10px;width:205px;padding:9px;background:rgba(35,35,35,.96);border:1px solid #555;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.3)}.paint-panel-title{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:8px}.paint-panel label{display:grid;grid-template-columns:60px 1fr;align-items:center;gap:6px;margin:6px 0}.paint-panel input[type=color]{width:100%;height:25px;background:#1f1f1f;border:1px solid #4a4a4a}.paint-panel input[type=range]{width:100%}.paint-panel button{width:100%;min-height:28px;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;border:1px solid #494949;border-radius:3px;background:#303030;color:#ddd}.paint-panel button:hover{background:#454545}`;
  document.head.appendChild(style);

  let active = false;
  let painting = false;
  let mesh = null;
  let material = null;
  let paintCanvas = null;
  let paintCtx = null;
  let texture = null;

  function prepare() {
    mesh = editor.selected;
    if (!mesh?.isMesh || mesh.isSkinnedMesh) {
      editor.events.onStatus('Texture Paint: выберите обычный Mesh');
      return false;
    }
    if (!mesh.geometry.getAttribute('uv')) {
      editor.events.onStatus('Texture Paint: у Mesh нет UV — сначала откройте UV Editing');
      return false;
    }
    material = getMaterial(mesh);
    if (!material) {
      editor.events.onStatus('Texture Paint: нужен PBR материал MeshStandardMaterial');
      return false;
    }
    editor.checkpoint('Prepare texture paint');
    paintCanvas = canvasFromTexture(material.map, 1024);
    paintCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
    const old = material.map;
    texture = new THREE.CanvasTexture(paintCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = old?.wrapS ?? THREE.RepeatWrapping;
    texture.wrapT = old?.wrapT ?? THREE.RepeatWrapping;
    texture.offset.copy(old?.offset ?? new THREE.Vector2());
    texture.repeat.copy(old?.repeat ?? new THREE.Vector2(1, 1));
    texture.center.copy(old?.center ?? new THREE.Vector2(0.5, 0.5));
    texture.rotation = old?.rotation ?? 0;
    material.map = texture;
    material.needsUpdate = true;
    window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture, key: 'map' } }));
    return true;
  }

  function enter() {
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
    if (!prepare()) return false;
    active = true;
    panel.hidden = false;
    editor.transform.detach();
    editor.events.onStatus('Texture Paint · ЛКМ рисовать · MMB навигация');
    refreshIcons();
    return true;
  }

  function leave() {
    if (!active) return;
    active = false;
    painting = false;
    panel.hidden = true;
    if (editor.selected) editor.transform.attach(editor.selected);
  }

  tabs.addEventListener('click', (event) => {
    const selectedTab = event.target.closest('.workspace-tab');
    if (!selectedTab || selectedTab.disabled) return;
    if (selectedTab.dataset.workspace === 'paint') enter();
    else leave();
  }, { capture: true });

  function transformedUV(uv) {
    const next = uv.clone();
    if (texture) texture.transformUv(next);
    return next;
  }

  function paintAt(event) {
    if (!active || !painting || !mesh || !paintCtx) return;
    const rect = editor.renderer.domElement.getBoundingClientRect();
    editor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    editor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    editor.raycaster.setFromCamera(editor.pointer, editor.camera);
    const hit = editor.raycaster.intersectObject(mesh, false)[0];
    if (!hit?.uv) return;
    const uv = transformedUV(hit.uv);
    const x = uv.x * paintCanvas.width;
    const y = (1 - uv.y) * paintCanvas.height;
    const radius = Number(panel.querySelector('[data-paint="size"]').value);
    const strength = Number(panel.querySelector('[data-paint="strength"]').value);
    const color = panel.querySelector('[data-paint="color"]').value;
    const gradient = paintCtx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(Math.max(0, 1 - strength), color);
    gradient.addColorStop(1, `${color}00`);
    paintCtx.save();
    paintCtx.globalCompositeOperation = 'source-over';
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
    editor.beginHistory('Texture paint stroke');
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
    window.dispatchEvent(new CustomEvent('gluestack:texture-changed', { detail: { mesh, texture, key: 'map' } }));
  }, true);

  panel.querySelector('[data-paint-action="clear"]').addEventListener('click', () => {
    if (!paintCtx) return;
    editor.checkpoint('Texture paint fill');
    paintCtx.fillStyle = '#ffffff';
    paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
    texture.needsUpdate = true;
  });

  refreshIcons();
  return { tab, panel, enter, leave, get active() { return active; } };
}
