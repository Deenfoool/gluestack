function helperLights(editor) {
  const hemi = editor.scene.children.find((object) => object.parent === editor.scene && object.isHemisphereLight) ?? null;
  const directionals = editor.scene.children.filter((object) => object.parent === editor.scene && object.isDirectionalLight);
  return { hemi, key: directionals[0] ?? null, fill: directionals[1] ?? null };
}

function captureViewport(editor) {
  const { hemi, key, fill } = helperLights(editor);
  return {
    background: editor.scene.background?.isColor ? editor.scene.background.getHex() : null,
    exposure: editor.renderer.toneMappingExposure,
    cameraPosition: editor.camera.position.toArray(),
    cameraQuaternion: editor.camera.quaternion.toArray(),
    cameraUp: editor.camera.up.toArray(),
    cameraFov: editor.camera.fov,
    cameraNear: editor.camera.near,
    cameraFar: editor.camera.far,
    orbitTarget: editor.orbit.target.toArray(),
    hemisphereIntensity: hemi?.intensity ?? null,
    keyIntensity: key?.intensity ?? null,
    fillIntensity: fill?.intensity ?? null,
  };
}

function restoreViewport(editor, state) {
  if (!state) return;
  if (Number.isInteger(state.background) && editor.scene.background?.isColor) editor.scene.background.setHex(state.background);
  if (Number.isFinite(state.exposure)) editor.renderer.toneMappingExposure = state.exposure;
  if (Array.isArray(state.cameraPosition)) editor.camera.position.fromArray(state.cameraPosition);
  if (Array.isArray(state.cameraQuaternion)) editor.camera.quaternion.fromArray(state.cameraQuaternion);
  if (Array.isArray(state.cameraUp)) editor.camera.up.fromArray(state.cameraUp);
  if (Number.isFinite(state.cameraFov)) editor.camera.fov = state.cameraFov;
  if (Number.isFinite(state.cameraNear)) editor.camera.near = Math.max(0.0001, state.cameraNear);
  if (Number.isFinite(state.cameraFar)) editor.camera.far = Math.max(editor.camera.near + 0.01, state.cameraFar);
  if (Array.isArray(state.orbitTarget)) editor.orbit.target.fromArray(state.orbitTarget);

  const { hemi, key, fill } = helperLights(editor);
  if (hemi && Number.isFinite(state.hemisphereIntensity)) hemi.intensity = Math.max(0, state.hemisphereIntensity);
  if (key && Number.isFinite(state.keyIntensity)) key.intensity = Math.max(0, state.keyIntensity);
  if (fill && Number.isFinite(state.fillIntensity)) fill.intensity = Math.max(0, state.fillIntensity);

  editor.camera.updateProjectionMatrix();
  editor.orbit.update();

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

export function installViewportHistory(editor) {
  if (!editor || editor.__gluestackViewportHistory) return null;
  editor.__gluestackViewportHistory = true;

  const originalCapture = editor.captureState.bind(editor);
  editor.captureState = () => ({
    ...originalCapture(),
    viewportState: captureViewport(editor),
  });

  const originalRestore = editor.restoreState.bind(editor);
  editor.restoreState = (state) => {
    originalRestore(state);
    restoreViewport(editor, state?.viewportState);
  };

  const sceneMenu = document.querySelector('.scene-menu');
  if (sceneMenu) {
    const begin = (event) => {
      if (!event.target.closest?.('.scene-field input')) return;
      editor.beginHistory('Scene / Camera settings');
    };
    const commit = (event) => {
      if (!event.target.closest?.('.scene-field input')) return;
      editor.commitHistory();
    };
    sceneMenu.addEventListener('pointerdown', begin, true);
    sceneMenu.addEventListener('keydown', begin, true);
    sceneMenu.addEventListener('change', commit, true);
    sceneMenu.addEventListener('focusout', commit, true);

    const reset = sceneMenu.querySelector('[data-scene-action="reset"]');
    reset?.addEventListener('pointerdown', () => editor.checkpoint('Reset view'), true);
  }

  return {
    capture: () => captureViewport(editor),
    restore: (state) => restoreViewport(editor, state),
  };
}
