import { refreshIcons } from '../ui.js';

const STORAGE_KEY = 'gluestack.settings.v1';
const SETTINGS_FORMAT = 'gluestack-settings';
const SETTINGS_VERSION = 1;

const DEFAULTS = Object.freeze({
  general: {
    autosave: true,
    autosaveDelaySeconds: 2,
  },
  viewport: {
    background: '#393939',
    exposure: 1,
    grid: true,
    axes: true,
    fov: 50,
    near: 0.01,
    far: 5000,
    pixelRatioLimit: 2,
    gizmoSize: 1,
  },
  navigation: {
    damping: true,
    dampingFactor: 0.08,
    rotateSpeed: 1,
    panSpeed: 1,
    zoomSpeed: 1,
  },
  transform: {
    moveSnap: 1,
    rotateSnapDegrees: 15,
    scaleSnap: 0.1,
  },
});

function cloneDefaults() {
  return structuredClone(DEFAULTS);
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function color(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function normalizeSettings(raw = {}) {
  const defaults = cloneDefaults();
  const general = raw.general ?? {};
  const viewport = raw.viewport ?? {};
  const navigation = raw.navigation ?? {};
  const transform = raw.transform ?? {};
  return {
    general: {
      autosave: boolean(general.autosave, defaults.general.autosave),
      autosaveDelaySeconds: number(general.autosaveDelaySeconds, defaults.general.autosaveDelaySeconds, 0.5, 60),
    },
    viewport: {
      background: color(viewport.background, defaults.viewport.background),
      exposure: number(viewport.exposure, defaults.viewport.exposure, 0.1, 4),
      grid: boolean(viewport.grid, defaults.viewport.grid),
      axes: boolean(viewport.axes, defaults.viewport.axes),
      fov: number(viewport.fov, defaults.viewport.fov, 10, 120),
      near: number(viewport.near, defaults.viewport.near, 0.0001, 10),
      far: number(viewport.far, defaults.viewport.far, 10, 100000),
      pixelRatioLimit: number(viewport.pixelRatioLimit, defaults.viewport.pixelRatioLimit, 0.5, 3),
      gizmoSize: number(viewport.gizmoSize, defaults.viewport.gizmoSize, 0.5, 2.5),
    },
    navigation: {
      damping: boolean(navigation.damping, defaults.navigation.damping),
      dampingFactor: number(navigation.dampingFactor, defaults.navigation.dampingFactor, 0.01, 0.5),
      rotateSpeed: number(navigation.rotateSpeed, defaults.navigation.rotateSpeed, 0.1, 4),
      panSpeed: number(navigation.panSpeed, defaults.navigation.panSpeed, 0.1, 4),
      zoomSpeed: number(navigation.zoomSpeed, defaults.navigation.zoomSpeed, 0.1, 4),
    },
    transform: {
      moveSnap: number(transform.moveSnap, defaults.transform.moveSnap, 0.001, 1000),
      rotateSnapDegrees: number(transform.rotateSnapDegrees, defaults.transform.rotateSnapDegrees, 0.1, 180),
      scaleSnap: number(transform.scaleSnap, defaults.transform.scaleSnap, 0.001, 10),
    },
  };
}

function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    if (parsed?.format === SETTINGS_FORMAT && parsed?.version === SETTINGS_VERSION) {
      return normalizeSettings(parsed.settings);
    }
    return normalizeSettings(parsed?.settings ?? parsed);
  } catch (error) {
    console.warn('[gluestack] settings: failed to read localStorage', error);
    return cloneDefaults();
  }
}

function saveStoredSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION,
      savedAt: new Date().toISOString(),
      settings,
    }));
    return true;
  } catch (error) {
    console.warn('[gluestack] settings: failed to save localStorage', error);
    return false;
  }
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function settingInput(root, path) {
  return root.querySelector(`[data-setting="${path}"]`);
}

function writeForm(root, settings) {
  for (const [path, value] of [
    ['general.autosave', settings.general.autosave],
    ['general.autosaveDelaySeconds', settings.general.autosaveDelaySeconds],
    ['viewport.background', settings.viewport.background],
    ['viewport.exposure', settings.viewport.exposure],
    ['viewport.grid', settings.viewport.grid],
    ['viewport.axes', settings.viewport.axes],
    ['viewport.fov', settings.viewport.fov],
    ['viewport.near', settings.viewport.near],
    ['viewport.far', settings.viewport.far],
    ['viewport.pixelRatioLimit', settings.viewport.pixelRatioLimit],
    ['viewport.gizmoSize', settings.viewport.gizmoSize],
    ['navigation.damping', settings.navigation.damping],
    ['navigation.dampingFactor', settings.navigation.dampingFactor],
    ['navigation.rotateSpeed', settings.navigation.rotateSpeed],
    ['navigation.panSpeed', settings.navigation.panSpeed],
    ['navigation.zoomSpeed', settings.navigation.zoomSpeed],
    ['transform.moveSnap', settings.transform.moveSnap],
    ['transform.rotateSnapDegrees', settings.transform.rotateSnapDegrees],
    ['transform.scaleSnap', settings.transform.scaleSnap],
  ]) {
    const input = settingInput(root, path);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }
}

function readForm(root) {
  const value = (path) => settingInput(root, path)?.value;
  const checked = (path) => Boolean(settingInput(root, path)?.checked);
  return normalizeSettings({
    general: {
      autosave: checked('general.autosave'),
      autosaveDelaySeconds: value('general.autosaveDelaySeconds'),
    },
    viewport: {
      background: value('viewport.background'),
      exposure: value('viewport.exposure'),
      grid: checked('viewport.grid'),
      axes: checked('viewport.axes'),
      fov: value('viewport.fov'),
      near: value('viewport.near'),
      far: value('viewport.far'),
      pixelRatioLimit: value('viewport.pixelRatioLimit'),
      gizmoSize: value('viewport.gizmoSize'),
    },
    navigation: {
      damping: checked('navigation.damping'),
      dampingFactor: value('navigation.dampingFactor'),
      rotateSpeed: value('navigation.rotateSpeed'),
      panSpeed: value('navigation.panSpeed'),
      zoomSpeed: value('navigation.zoomSpeed'),
    },
    transform: {
      moveSnap: value('transform.moveSnap'),
      rotateSnapDegrees: value('transform.rotateSnapDegrees'),
      scaleSnap: value('transform.scaleSnap'),
    },
  });
}

function createPanel() {
  const root = document.createElement('div');
  root.dataset.gluestackSettings = '';
  root.className = 'settings-overlay';
  root.hidden = true;
  root.innerHTML = `
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
      <header class="settings-header">
        <div><strong>Settings</strong><span>gluestack preferences</span></div>
        <button type="button" class="settings-icon" data-settings-action="close" title="Close"><i data-lucide="x"></i></button>
      </header>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="Settings categories">
          <button type="button" class="active" data-settings-tab="general"><i data-lucide="settings-2"></i><span>General</span></button>
          <button type="button" data-settings-tab="viewport"><i data-lucide="monitor"></i><span>Viewport</span></button>
          <button type="button" data-settings-tab="navigation"><i data-lucide="mouse-pointer-2"></i><span>Navigation</span></button>
          <button type="button" data-settings-tab="transform"><i data-lucide="move-3d"></i><span>Transform</span></button>
        </nav>
        <div class="settings-pages">
          <div class="settings-page" data-settings-page="general">
            <h2>General</h2>
            <p>Global editor preferences. They are stored locally in this browser and are not written into GLB files.</p>
            <label class="settings-row"><span><strong>Autosave</strong><small>Save dirty projects to IndexedDB automatically.</small></span><input data-setting="general.autosave" type="checkbox"></label>
            <label class="settings-row"><span><strong>Autosave delay</strong><small>Delay after the last edit before autosave starts.</small></span><div class="settings-number"><input data-setting="general.autosaveDelaySeconds" type="number" min="0.5" max="60" step="0.5"><em>s</em></div></label>
          </div>
          <div class="settings-page" data-settings-page="viewport" hidden>
            <h2>Viewport</h2>
            <p>Rendering and camera defaults applied immediately.</p>
            <label class="settings-row"><span><strong>Background</strong><small>Viewport clear color.</small></span><input data-setting="viewport.background" type="color"></label>
            <label class="settings-row"><span><strong>Exposure</strong><small>ACES tone mapping exposure.</small></span><input data-setting="viewport.exposure" type="number" min="0.1" max="4" step="0.1"></label>
            <label class="settings-row"><span><strong>Grid</strong><small>Show the world grid helper.</small></span><input data-setting="viewport.grid" type="checkbox"></label>
            <label class="settings-row"><span><strong>Axes</strong><small>Show XYZ axes at the world origin.</small></span><input data-setting="viewport.axes" type="checkbox"></label>
            <label class="settings-row"><span><strong>Camera FOV</strong><small>Perspective field of view.</small></span><div class="settings-number"><input data-setting="viewport.fov" type="number" min="10" max="120" step="1"><em>°</em></div></label>
            <label class="settings-row"><span><strong>Near clip</strong><small>Closest visible camera distance.</small></span><input data-setting="viewport.near" type="number" min="0.0001" max="10" step="0.01"></label>
            <label class="settings-row"><span><strong>Far clip</strong><small>Farthest visible camera distance.</small></span><input data-setting="viewport.far" type="number" min="10" max="100000" step="10"></label>
            <label class="settings-row"><span><strong>Pixel ratio limit</strong><small>Caps renderer DPR to balance sharpness and GPU cost.</small></span><input data-setting="viewport.pixelRatioLimit" type="number" min="0.5" max="3" step="0.25"></label>
            <label class="settings-row"><span><strong>Gizmo size</strong><small>Move / Rotate / Scale handle size.</small></span><input data-setting="viewport.gizmoSize" type="number" min="0.5" max="2.5" step="0.1"></label>
          </div>
          <div class="settings-page" data-settings-page="navigation" hidden>
            <h2>Navigation</h2>
            <p>OrbitControls behaviour for the 3D viewport.</p>
            <label class="settings-row"><span><strong>Damping</strong><small>Smooth camera movement after input.</small></span><input data-setting="navigation.damping" type="checkbox"></label>
            <label class="settings-row"><span><strong>Damping factor</strong><small>Higher values stop movement faster.</small></span><input data-setting="navigation.dampingFactor" type="number" min="0.01" max="0.5" step="0.01"></label>
            <label class="settings-row"><span><strong>Orbit speed</strong><small>Middle-mouse orbit sensitivity.</small></span><input data-setting="navigation.rotateSpeed" type="number" min="0.1" max="4" step="0.1"></label>
            <label class="settings-row"><span><strong>Pan speed</strong><small>Shift + middle-mouse pan sensitivity.</small></span><input data-setting="navigation.panSpeed" type="number" min="0.1" max="4" step="0.1"></label>
            <label class="settings-row"><span><strong>Zoom speed</strong><small>Mouse-wheel zoom sensitivity.</small></span><input data-setting="navigation.zoomSpeed" type="number" min="0.1" max="4" step="0.1"></label>
          </div>
          <div class="settings-page" data-settings-page="transform" hidden>
            <h2>Transform</h2>
            <p>Snap increments used by the toolbar magnet and TransformControls.</p>
            <label class="settings-row"><span><strong>Move snap</strong><small>Translation step in world units.</small></span><input data-setting="transform.moveSnap" type="number" min="0.001" max="1000" step="0.1"></label>
            <label class="settings-row"><span><strong>Rotation snap</strong><small>Rotation step when snapping is enabled.</small></span><div class="settings-number"><input data-setting="transform.rotateSnapDegrees" type="number" min="0.1" max="180" step="1"><em>°</em></div></label>
            <label class="settings-row"><span><strong>Scale snap</strong><small>Scale increment when snapping is enabled.</small></span><input data-setting="transform.scaleSnap" type="number" min="0.001" max="10" step="0.01"></label>
          </div>
        </div>
      </div>
      <footer class="settings-footer">
        <span data-settings-status>Saved locally</span>
        <div></div>
        <button type="button" data-settings-action="import"><i data-lucide="upload"></i><span>Import</span></button>
        <button type="button" data-settings-action="export"><i data-lucide="download"></i><span>Export</span></button>
        <button type="button" data-settings-action="reset"><i data-lucide="rotate-ccw"></i><span>Reset</span></button>
        <button type="button" class="primary" data-settings-action="close">Done</button>
      </footer>
    </section>`;

  const style = document.createElement('style');
  style.textContent = `
    .settings-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:24px}
    .settings-overlay[hidden]{display:none}
    .settings-dialog{width:min(860px,calc(100vw - 32px));height:min(650px,calc(100vh - 32px));display:grid;grid-template-rows:auto 1fr auto;background:#242424;border:1px solid #4b4b4b;border-radius:7px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;color:#ddd}
    .settings-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #3d3d3d;background:#292929}
    .settings-header>div{display:flex;align-items:baseline;gap:10px}.settings-header strong{font-size:14px}.settings-header span{font-size:11px;color:#8f8f8f}
    .settings-icon,.settings-footer button,.settings-nav button{border:1px solid transparent;background:transparent;color:#ccc;border-radius:4px;cursor:pointer}
    .settings-icon{width:30px;height:30px;display:grid;place-items:center}.settings-icon:hover{background:#373737}
    .settings-body{display:grid;grid-template-columns:180px 1fr;min-height:0}
    .settings-nav{padding:10px;border-right:1px solid #3d3d3d;background:#202020;display:flex;flex-direction:column;gap:3px}
    .settings-nav button{display:flex;align-items:center;gap:9px;text-align:left;padding:8px 9px;font-size:12px}.settings-nav button:hover{background:#303030}.settings-nav button.active{background:#3a3a3a;color:#fff}
    .settings-nav svg{width:15px;height:15px}
    .settings-pages{overflow:auto;padding:18px 22px}.settings-page h2{margin:0 0 5px;font-size:18px}.settings-page>p{margin:0 0 18px;color:#949494;font-size:11px;line-height:1.5}
    .settings-row{min-height:54px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid #333;padding:8px 0}.settings-row>span{display:flex;flex-direction:column;gap:3px}.settings-row strong{font-size:12px;font-weight:600}.settings-row small{font-size:10px;color:#8e8e8e;line-height:1.35}
    .settings-row input[type="number"]{width:92px}.settings-row input[type="color"]{width:42px;height:28px;padding:2px}.settings-row input[type="checkbox"]{width:16px;height:16px;accent-color:#d78327}.settings-row input[type="number"],.settings-row input[type="color"]{background:#191919;color:#ddd;border:1px solid #505050;border-radius:3px;padding:5px 6px}
    .settings-number{display:flex;align-items:center;gap:5px}.settings-number em{font-style:normal;font-size:10px;color:#999;min-width:12px}
    .settings-footer{display:grid;grid-template-columns:auto 1fr repeat(4,auto);align-items:center;gap:7px;padding:10px 12px;border-top:1px solid #3d3d3d;background:#292929}.settings-footer>span{font-size:10px;color:#8f8f8f}.settings-footer button{padding:6px 10px;border-color:#4b4b4b;background:#333;display:flex;align-items:center;gap:6px;font-size:11px}.settings-footer button:hover{background:#3e3e3e}.settings-footer button.primary{background:#b76518;border-color:#d37b27;color:#fff}.settings-footer svg{width:13px;height:13px}
    @media(max-width:680px){.settings-body{grid-template-columns:1fr}.settings-nav{border-right:0;border-bottom:1px solid #3d3d3d;flex-direction:row;overflow:auto}.settings-nav button span{display:none}.settings-dialog{height:calc(100vh - 16px)}.settings-footer{grid-template-columns:1fr repeat(2,auto)}.settings-footer>span,.settings-footer>div,.settings-footer button[data-settings-action="import"],.settings-footer button[data-settings-action="export"]{display:none}}
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);
  return root;
}

export function installSettings({ editor, projects = null }) {
  if (!editor || editor.settings) return editor?.settings ?? null;

  const state = loadStoredSettings();
  const root = createPanel();
  const status = root.querySelector('[data-settings-status]');
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.hidden = true;
  root.appendChild(importInput);

  const originalSetSnapEnabled = editor.setSnapEnabled.bind(editor);
  const originalScheduleAutosave = projects?.scheduleAutosave?.bind(projects) ?? null;

  const api = {
    state,
    root,
    open,
    close,
    apply,
    reset,
    exportSettings,
    importSettings,
  };

  editor.settings = api;
  window.__gluestackSettings = api;

  editor.setSnapEnabled = (enabled) => {
    editor.snapEnabled = Boolean(enabled);
    const snap = api.state.transform;
    editor.transform.setTranslationSnap(editor.snapEnabled ? snap.moveSnap : null);
    editor.transform.setRotationSnap(editor.snapEnabled ? snap.rotateSnapDegrees * Math.PI / 180 : null);
    editor.transform.setScaleSnap(editor.snapEnabled ? snap.scaleSnap : null);
    const snapButton = document.querySelector('[data-snap]');
    snapButton?.classList.toggle('active', editor.snapEnabled);
    snapButton?.setAttribute('aria-pressed', String(editor.snapEnabled));
    editor.events.onStatus(editor.snapEnabled
      ? `Snap включён · ${snap.moveSnap}u / ${snap.rotateSnapDegrees}° / ${snap.scaleSnap}`
      : 'Snap выключен');
  };
  editor.__gluestackDefaultSetSnapEnabled = originalSetSnapEnabled;

  if (projects && originalScheduleAutosave) {
    projects.scheduleAutosave = (...args) => {
      if (!api.state.general.autosave) return false;
      return originalScheduleAutosave(...args);
    };
  }

  function apply({ announce = false } = {}) {
    const { viewport, navigation, transform, general } = api.state;

    if (editor.scene.background?.isColor) editor.scene.background.set(viewport.background);
    if (editor.grid) editor.grid.visible = viewport.grid;
    if (editor.axes) editor.axes.visible = viewport.axes;
    editor.renderer.toneMappingExposure = viewport.exposure;
    editor.camera.fov = viewport.fov;
    editor.camera.near = viewport.near;
    editor.camera.far = Math.max(viewport.near + 0.01, viewport.far);
    editor.camera.updateProjectionMatrix();
    editor.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, viewport.pixelRatioLimit));
    editor.resize();
    editor.transform.setSize(viewport.gizmoSize);

    editor.orbit.enableDamping = navigation.damping;
    editor.orbit.dampingFactor = navigation.dampingFactor;
    editor.orbit.rotateSpeed = navigation.rotateSpeed;
    editor.orbit.panSpeed = navigation.panSpeed;
    editor.orbit.zoomSpeed = navigation.zoomSpeed;
    editor.orbit.update();

    if (editor.snapEnabled) {
      editor.transform.setTranslationSnap(transform.moveSnap);
      editor.transform.setRotationSnap(transform.rotateSnapDegrees * Math.PI / 180);
      editor.transform.setScaleSnap(transform.scaleSnap);
    }

    if (projects) {
      projects.autosaveDelay = Math.round(general.autosaveDelaySeconds * 1000);
      if (!general.autosave) clearTimeout(projects.autosaveTimer);
    }

    const sceneBg = document.querySelector('#scene-bg');
    if (sceneBg && document.activeElement !== sceneBg) sceneBg.value = viewport.background;
    const sceneFov = document.querySelector('#scene-fov');
    if (sceneFov && document.activeElement !== sceneFov) sceneFov.value = String(editor.camera.fov);
    const sceneNear = document.querySelector('#scene-near');
    if (sceneNear && document.activeElement !== sceneNear) sceneNear.value = String(editor.camera.near);
    const sceneFar = document.querySelector('#scene-far');
    if (sceneFar && document.activeElement !== sceneFar) sceneFar.value = String(editor.camera.far);

    if (announce) editor.events.onStatus('Settings применены');
  }

  function persist(message = 'Saved locally') {
    saveStoredSettings(api.state);
    if (status) status.textContent = message;
  }

  function setState(next, { message = 'Saved locally', announce = false } = {}) {
    const normalized = normalizeSettings(next);
    Object.assign(api.state.general, normalized.general);
    Object.assign(api.state.viewport, normalized.viewport);
    Object.assign(api.state.navigation, normalized.navigation);
    Object.assign(api.state.transform, normalized.transform);
    writeForm(root, api.state);
    apply({ announce });
    persist(message);
    window.dispatchEvent(new CustomEvent('gluestack:settings-changed', { detail: structuredClone(api.state) }));
  }

  function open() {
    writeForm(root, api.state);
    root.hidden = false;
    document.querySelector('#file-menu')?.removeAttribute('open');
    root.querySelector('.settings-nav button.active')?.focus();
  }

  function close() {
    root.hidden = true;
  }

  function reset() {
    if (!window.confirm('Reset all gluestack settings to defaults?')) return false;
    setState(cloneDefaults(), { message: 'Defaults restored', announce: true });
    return true;
  }

  function exportSettings() {
    downloadJson({
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION,
      exportedAt: new Date().toISOString(),
      settings: api.state,
    }, 'gluestack-settings.json');
    if (status) status.textContent = 'Settings exported';
  }

  async function importSettings(file) {
    if (!file) return false;
    const parsed = JSON.parse(await file.text());
    if (parsed?.format && parsed.format !== SETTINGS_FORMAT) throw new Error('Это не файл настроек gluestack');
    if (parsed?.version && parsed.version > SETTINGS_VERSION) throw new Error(`Настройки версии ${parsed.version} новее поддерживаемой v${SETTINGS_VERSION}`);
    setState(parsed?.settings ?? parsed, { message: `Imported ${file.name}`, announce: true });
    return true;
  }

  root.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      root.querySelectorAll('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === button));
      root.querySelectorAll('[data-settings-page]').forEach((page) => { page.hidden = page.dataset.settingsPage !== button.dataset.settingsTab; });
    });
  });

  root.addEventListener('change', (event) => {
    if (!event.target.closest?.('[data-setting]')) return;
    setState(readForm(root));
  });

  root.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-settings-action]')?.dataset.settingsAction;
    if (action === 'close') close();
    else if (action === 'reset') reset();
    else if (action === 'export') exportSettings();
    else if (action === 'import') importInput.click();
    else if (event.target === root) close();
  });

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      await importSettings(file);
    } catch (error) {
      console.error('[gluestack] settings import failed', error);
      if (status) status.textContent = error.message || String(error);
      editor.events.onStatus(`Settings: ${error.message || error}`);
    } finally {
      importInput.value = '';
    }
  });

  window.addEventListener('keydown', (event) => {
    if (root.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, { capture: true });

  const menu = document.querySelector('#file-menu .menu-popover');
  if (menu) {
    const separator = document.createElement('div');
    separator.className = 'menu-separator';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.settingsOpen = '';
    button.innerHTML = '<i data-lucide="settings"></i><span>Settings…</span>';
    button.addEventListener('click', open);
    menu.append(separator, button);
  }

  writeForm(root, api.state);
  apply();
  refreshIcons();
  return api;
}
