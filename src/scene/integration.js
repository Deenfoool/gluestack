import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

function field(label, id, type = 'number', value = '') {
  return `<label class="scene-field"><span>${label}</span><input id="${id}" type="${type}" value="${value}" ${type === 'number' ? 'step="0.1"' : ''} /></label>`;
}

export function installSceneControls({ editor }) {
  const bar = document.querySelector('.main-menu-bar');
  const spacer = bar?.querySelector('.main-menu-spacer');
  if (!bar || !spacer) return null;

  const menu = document.createElement('details');
  menu.className = 'menu scene-menu';
  menu.innerHTML = `
    <summary>Scene</summary>
    <div class="menu-popover scene-popover">
      <div class="scene-section-title">Viewport</div>
      ${field('Background', 'scene-bg', 'color', '#393939')}
      ${field('Hemisphere', 'scene-hemi', 'number', '1.8')}
      ${field('Key Light', 'scene-key', 'number', '2.4')}
      ${field('Fill Light', 'scene-fill', 'number', '0.8')}
      <div class="menu-separator"></div>
      <div class="scene-section-title">Camera</div>
      ${field('FOV', 'scene-fov', 'number', '50')}
      ${field('Near', 'scene-near', 'number', '0.01')}
      ${field('Far', 'scene-far', 'number', '5000')}
      <button type="button" data-scene-action="reset"><i data-lucide="rotate-ccw"></i><span>Reset View</span></button>
      <div class="menu-separator"></div>
      <div class="scene-section-title">Add to exported scene</div>
      <button type="button" data-scene-action="point"><i data-lucide="lightbulb"></i><span>Point Light</span></button>
      <button type="button" data-scene-action="sun"><i data-lucide="sun"></i><span>Sun / Directional</span></button>
      <button type="button" data-scene-action="camera"><i data-lucide="camera"></i><span>Camera from View</span></button>
    </div>`;
  bar.insertBefore(menu, spacer);

  const style = document.createElement('style');
  style.textContent = `
    .scene-popover{min-width:260px}.scene-section-title{font-weight:600;color:#bbb;padding:5px 7px 3px}.scene-field{display:grid;grid-template-columns:86px 1fr;gap:7px;align-items:center;padding:4px 7px}.scene-field input{width:100%;min-width:0;height:24px;color:#eee;background:#1f1f1f;border:1px solid #4a4a4a;border-radius:3px;padding:2px 5px}.scene-field input[type=color]{padding:1px}`;
  document.head.appendChild(style);

  const hemi = editor.scene.children.find((object) => object.isHemisphereLight);
  const directionals = editor.scene.children.filter((object) => object.isDirectionalLight && object.parent === editor.scene);
  const key = directionals[0];
  const fill = directionals[1];
  const bg = menu.querySelector('#scene-bg');
  const hemiInput = menu.querySelector('#scene-hemi');
  const keyInput = menu.querySelector('#scene-key');
  const fillInput = menu.querySelector('#scene-fill');
  const fov = menu.querySelector('#scene-fov');
  const near = menu.querySelector('#scene-near');
  const far = menu.querySelector('#scene-far');

  bg.value = `#${editor.scene.background.getHexString()}`;
  if (hemi) hemiInput.value = hemi.intensity;
  if (key) keyInput.value = key.intensity;
  if (fill) fillInput.value = fill.intensity;
  fov.value = editor.camera.fov;
  near.value = editor.camera.near;
  far.value = editor.camera.far;

  bg.addEventListener('input', () => editor.scene.background.set(bg.value));
  hemiInput.addEventListener('input', () => { if (hemi) hemi.intensity = Math.max(0, Number(hemiInput.value) || 0); });
  keyInput.addEventListener('input', () => { if (key) key.intensity = Math.max(0, Number(keyInput.value) || 0); });
  fillInput.addEventListener('input', () => { if (fill) fill.intensity = Math.max(0, Number(fillInput.value) || 0); });
  const updateCamera = () => {
    editor.camera.fov = THREE.MathUtils.clamp(Number(fov.value) || 50, 1, 179);
    editor.camera.near = Math.max(0.0001, Number(near.value) || 0.01);
    editor.camera.far = Math.max(editor.camera.near + 0.01, Number(far.value) || 5000);
    editor.camera.updateProjectionMatrix();
  };
  [fov, near, far].forEach((input) => input.addEventListener('change', updateCamera));

  menu.querySelector('[data-scene-action="reset"]').addEventListener('click', () => {
    editor.camera.position.set(6, 4.5, 7);
    editor.camera.up.set(0, 1, 0);
    editor.orbit.target.set(0, 0, 0);
    editor.camera.fov = 50;
    editor.camera.near = 0.01;
    editor.camera.far = 5000;
    editor.camera.updateProjectionMatrix();
    editor.orbit.update();
    fov.value = 50; near.value = 0.01; far.value = 5000;
    editor.events.onStatus('View reset');
  });

  function addObject(object, label) {
    editor.checkpoint(`Add ${label}`);
    editor.assignIds(object, true);
    editor.modelRoot.add(object);
    editor.select(object);
    editor.events.onStructure();
    editor.events.onStatus(`${label} добавлен в экспортируемую сцену`);
    return object;
  }

  menu.querySelector('[data-scene-action="point"]').addEventListener('click', () => {
    const light = new THREE.PointLight(0xffffff, 8, 20, 2);
    light.name = editor.uniqueName('PointLight');
    light.position.copy(editor.camera.position);
    addObject(light, 'Point Light');
  });
  menu.querySelector('[data-scene-action="sun"]').addEventListener('click', () => {
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.name = editor.uniqueName('Sun');
    light.position.copy(editor.camera.position);
    light.quaternion.copy(editor.camera.quaternion);
    light.target.position.set(0, 0, -1);
    light.add(light.target);
    addObject(light, 'Directional Light');
  });
  menu.querySelector('[data-scene-action="camera"]').addEventListener('click', () => {
    const camera = new THREE.PerspectiveCamera(editor.camera.fov, editor.camera.aspect, editor.camera.near, editor.camera.far);
    camera.name = editor.uniqueName('Camera');
    camera.position.copy(editor.camera.position);
    camera.quaternion.copy(editor.camera.quaternion);
    camera.userData.gluestackCamera = true;
    addObject(camera, 'Camera');
  });

  refreshIcons();
  return { menu };
}
