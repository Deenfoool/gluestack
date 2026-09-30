import * as THREE from 'three';
import { clone as cloneSkeletonHierarchy } from 'three/addons/utils/SkeletonUtils.js';

const TEXTURE_KEYS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'displacementMap',
  'emissiveMap', 'metalnessMap', 'roughnessMap', 'lightMap', 'envMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap',
  'sheenRoughnessMap', 'specularColorMap', 'specularIntensityMap',
  'thicknessMap', 'transmissionMap', 'anisotropyMap',
];

function cloneCanvasImage(image) {
  if (typeof HTMLCanvasElement === 'undefined' || !(image instanceof HTMLCanvasElement)) return image;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  return canvas;
}

function cloneTexture(texture, cache) {
  if (!texture?.isTexture) return texture;
  if (cache.has(texture)) return cache.get(texture);
  const cloned = texture.clone();
  const clonedImage = cloneCanvasImage(texture.image);
  if (clonedImage !== texture.image) {
    cloned.source = new THREE.Source(clonedImage);
    cloned.needsUpdate = true;
  }
  cache.set(texture, cloned);
  return cloned;
}

function cloneMaterial(material, textureCache) {
  if (!material) return material;
  const cloned = material.clone();
  for (const key of TEXTURE_KEYS) {
    if (material[key]?.isTexture) cloned[key] = cloneTexture(material[key], textureCache);
  }
  return cloned;
}

function makeDeepClone(editor) {
  return function cloneObjectDeep(source) {
    const textureCache = new Map();
    const clonedRoot = cloneSkeletonHierarchy(source);
    const sourceNodes = [];
    const clonedNodes = [];
    source.traverse((node) => sourceNodes.push(node));
    clonedRoot.traverse((node) => clonedNodes.push(node));

    for (let index = 0; index < Math.min(sourceNodes.length, clonedNodes.length); index += 1) {
      const node = sourceNodes[index];
      const clone = clonedNodes[index];
      if (node.geometry) clone.geometry = node.geometry.clone();
      if (node.material) {
        clone.material = Array.isArray(node.material)
          ? node.material.map((material) => cloneMaterial(material, textureCache))
          : cloneMaterial(node.material, textureCache);
      }
    }
    return clonedRoot;
  }.bind(editor);
}

function installDeepHistory(editor) {
  if (editor.__gluestackDeepHistory) return;
  editor.__gluestackDeepHistory = true;
  editor.cloneObjectDeep = makeDeepClone(editor);
}

function helperLights(editor) {
  const hemi = editor.scene.children.find((object) => object.parent === editor.scene && object.isHemisphereLight) ?? null;
  const directionals = editor.scene.children.filter((object) => object.parent === editor.scene && object.isDirectionalLight);
  return { hemi, key: directionals[0] ?? null, fill: directionals[1] ?? null };
}

function updateSceneInputs(editor) {
  const { hemi, key, fill } = helperLights(editor);
  const set = (selector, value) => {
    const input = document.querySelector(selector);
    if (input && value !== undefined && value !== null) input.value = value;
  };
  if (editor.scene.background?.isColor) set('#scene-bg', `#${editor.scene.background.getHexString()}`);
  set('#scene-hemi', hemi?.intensity);
  set('#scene-key', key?.intensity);
  set('#scene-fill', fill?.intensity);
  set('#scene-fov', editor.camera.fov);
  set('#scene-near', editor.camera.near);
  set('#scene-far', editor.camera.far);
}

function installProjectState(editor, projects) {
  if (!projects || projects.__gluestackExtendedState) return;
  projects.__gluestackExtendedState = true;

  const originalMetadata = projects.metadata.bind(projects);
  projects.metadata = () => {
    const metadata = originalMetadata();
    const { hemi, key, fill } = helperLights(editor);
    return {
      ...metadata,
      version: 2,
      viewport: {
        background: editor.scene.background?.isColor ? editor.scene.background.getHex() : null,
        exposure: editor.renderer.toneMappingExposure,
        cameraNear: editor.camera.near,
        cameraFar: editor.camera.far,
        cameraUp: editor.camera.up.toArray(),
        hemisphereIntensity: hemi?.intensity ?? null,
        keyIntensity: key?.intensity ?? null,
        fillIntensity: fill?.intensity ?? null,
      },
    };
  };

  const originalLoad = projects.loadGlbBuffer.bind(projects);
  projects.loadGlbBuffer = async (buffer, metadata = {}) => {
    await originalLoad(buffer, metadata);
    const viewport = metadata.viewport;
    if (!viewport) return;

    if (Number.isInteger(viewport.background) && editor.scene.background?.isColor) {
      editor.scene.background.setHex(viewport.background);
    }
    if (Number.isFinite(viewport.exposure)) editor.renderer.toneMappingExposure = viewport.exposure;
    if (Number.isFinite(viewport.cameraNear)) editor.camera.near = Math.max(0.0001, viewport.cameraNear);
    if (Number.isFinite(viewport.cameraFar)) editor.camera.far = Math.max(editor.camera.near + 0.01, viewport.cameraFar);
    if (Array.isArray(viewport.cameraUp) && viewport.cameraUp.length >= 3) editor.camera.up.fromArray(viewport.cameraUp);

    const { hemi, key, fill } = helperLights(editor);
    if (hemi && Number.isFinite(viewport.hemisphereIntensity)) hemi.intensity = Math.max(0, viewport.hemisphereIntensity);
    if (key && Number.isFinite(viewport.keyIntensity)) key.intensity = Math.max(0, viewport.keyIntensity);
    if (fill && Number.isFinite(viewport.fillIntensity)) fill.intensity = Math.max(0, viewport.fillIntensity);
    editor.camera.updateProjectionMatrix();
    editor.orbit.update();
    updateSceneInputs(editor);
  };
}

function leaveSpecializedWorkspace() {
  const activeWorkspace = document.querySelector('.workspace-tab.active')?.dataset.workspace;
  if (activeWorkspace !== 'uv' && activeWorkspace !== 'paint') return;
  document.querySelector('[data-workspace="layout"]')?.click();
}

function installPropertiesCoordinator(editor, editMode) {
  const tabs = document.querySelector('.properties-tabs');
  const content = document.querySelector('.properties-content');
  if (!tabs || !content || tabs.dataset.gluestackCoordinated === 'true') return;
  tabs.dataset.gluestackCoordinated = 'true';

  const apply = () => {
    const active = tabs.querySelector('.property-tab.active');
    if (!active) return;
    const material = document.querySelector('#material-properties');
    const gameReady = document.querySelector('#game-ready-properties');
    const object = document.querySelector('#object-properties');
    const modifiers = document.querySelector('#modifier-properties');
    const empty = document.querySelector('#empty-properties');

    if (editMode?.active) {
      if (material) material.hidden = true;
      if (gameReady) gameReady.hidden = true;
      return;
    }

    if (active.dataset.propertyTab === 'material' && material) {
      if (!editor.selected?.isMesh) {
        material.hidden = true;
        if (gameReady) gameReady.hidden = true;
        if (object) object.hidden = true;
        if (modifiers) modifiers.hidden = true;
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'Выберите Mesh';
        }
        return;
      }
      if (empty) empty.hidden = true;
      if (object) object.hidden = true;
      if (modifiers) modifiers.hidden = true;
      if (gameReady) gameReady.hidden = true;
      material.hidden = false;
    } else if (active.dataset.gameReadyTab !== undefined && gameReady) {
      if (empty) empty.hidden = true;
      if (object) object.hidden = true;
      if (modifiers) modifiers.hidden = true;
      if (material) material.hidden = true;
      gameReady.hidden = false;
    } else {
      if (material) material.hidden = true;
      if (gameReady) gameReady.hidden = true;
    }
  };

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.property-tab');
    if (!button || button.disabled) return;
    tabs.querySelectorAll('.property-tab').forEach((item) => item.classList.toggle('active', item === button));
    requestAnimationFrame(apply);
  }, { capture: true });

  for (const eventName of ['onSelection', 'onStructure', 'onTransform']) {
    const previous = editor.events[eventName];
    editor.events[eventName] = (...args) => {
      previous(...args);
      if (eventName === 'onSelection') leaveSpecializedWorkspace();
      requestAnimationFrame(apply);
    };
  }
}

export function installRuntimeHardening({ editor, projects, editMode }) {
  installDeepHistory(editor);
  installProjectState(editor, projects);
  installPropertiesCoordinator(editor, editMode);
  updateSceneInputs(editor);
  return { updateSceneInputs: () => updateSceneInputs(editor) };
}
