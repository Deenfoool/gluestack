import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

function uniqueClipName(existing, base = 'Animation') {
  const names = new Set(existing.map((clip) => clip.name).filter(Boolean));
  if (!names.has(base)) return base;
  let index = 1;
  let candidate;
  do {
    candidate = `${base}.${String(index).padStart(3, '0')}`;
    index += 1;
  } while (names.has(candidate));
  return candidate;
}

function cloneClips(clips = []) {
  return clips.filter((clip) => clip instanceof THREE.AnimationClip).map((clip) => clip.clone());
}

function trackTargetsName(trackName, name) {
  if (!trackName || !name) return false;
  return trackName === name
    || trackName.startsWith(`${name}.`)
    || trackName.includes(`.bones[${name}]`)
    || trackName.startsWith(`bones[${name}]`);
}

function retargetTrackName(trackName, oldName, newName) {
  let next = trackName;
  if (next === oldName) next = newName;
  else if (next.startsWith(`${oldName}.`)) next = `${newName}${next.slice(oldName.length)}`;
  next = next.split(`.bones[${oldName}]`).join(`.bones[${newName}]`);
  if (next.startsWith(`bones[${oldName}]`)) next = `bones[${newName}]${next.slice(`bones[${oldName}]`.length)}`;
  return next;
}

function namesIn(objects = []) {
  const names = new Set();
  for (const root of objects) {
    root?.traverse?.((object) => { if (object.name) names.add(object.name); });
  }
  return names;
}

function nameUsedByOther(editor, object, name) {
  let used = false;
  editor.modelRoot?.traverse?.((candidate) => {
    if (!used && candidate !== object && candidate.name === name) used = true;
  });
  return used;
}

export function installAnimations(editor) {
  if (!editor || editor.__gluestackAnimations) return editor.__gluestackAnimations ?? null;

  editor.animations = Array.isArray(editor.animations) ? editor.animations : [];
  const originalParse = editor.exporter.parse.bind(editor.exporter);
  editor.exporter.parse = (input, onDone, onError, options = {}) => originalParse(
    input,
    onDone,
    onError,
    {
      ...options,
      animations: options.animations ?? editor.animations,
    },
  );

  let mixer = new THREE.AnimationMixer(editor.modelRoot);
  let activeAction = null;
  let activeClip = null;
  let raf = 0;
  let lastTime = performance.now();
  let speed = 1;

  const resetMixer = () => {
    if (activeAction) activeAction.stop();
    mixer.stopAllAction();
    mixer.uncacheRoot(editor.modelRoot);
    mixer = new THREE.AnimationMixer(editor.modelRoot);
    activeAction = null;
    activeClip = null;
    editor.events.onTransform(editor.selected);
  };

  const emitChanged = () => {
    window.dispatchEvent(new CustomEvent('gluestack:animations-changed', { detail: { clips: editor.animations } }));
  };

  const pruneMissingTargets = (candidateNames) => {
    if (!candidateNames?.size || !editor.animations.length) return 0;
    const liveNames = namesIn([editor.modelRoot]);
    const removedNames = [...candidateNames].filter((name) => !liveNames.has(name));
    if (!removedNames.length) return 0;
    let removedTracks = 0;
    const clips = [];
    for (const clip of editor.animations) {
      const next = clip.clone();
      next.tracks = next.tracks.filter((track) => {
        const remove = removedNames.some((name) => trackTargetsName(track.name, name));
        if (remove) removedTracks += 1;
        return !remove;
      });
      if (next.tracks.length) {
        next.resetDuration();
        clips.push(next);
      }
    }
    if (removedTracks) {
      editor.animations = clips;
      resetMixer();
      emitChanged();
      editor.events.onStatus(`Animation: удалено ${removedTracks} track(s) для удалённых узлов`);
    }
    return removedTracks;
  };

  const tick = (now) => {
    const delta = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (activeAction) mixer.update(delta * speed);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  editor.registerAnimations = (clips = [], { replace = false } = {}) => {
    const next = replace ? [] : [...editor.animations];
    for (const source of clips) {
      if (!(source instanceof THREE.AnimationClip)) continue;
      const clip = source.clone();
      clip.name = uniqueClipName(next, clip.name || 'Animation');
      next.push(clip);
    }
    editor.animations = next;
    resetMixer();
    emitChanged();
    return editor.animations;
  };

  editor.clearAnimations = () => {
    editor.animations = [];
    resetMixer();
    emitChanged();
  };

  editor.playAnimation = (clipOrIndex = 0) => {
    const clip = typeof clipOrIndex === 'number' ? editor.animations[clipOrIndex] : clipOrIndex;
    if (!clip) {
      editor.events.onStatus('Animation: clip не найден');
      return false;
    }
    resetMixer();
    activeClip = clip;
    activeAction = mixer.clipAction(clip);
    activeAction.reset().play();
    editor.events.onStatus(`Animation · ${clip.name || 'Clip'} · ${clip.duration.toFixed(2)}s`);
    return true;
  };

  editor.stopAnimation = () => {
    resetMixer();
    editor.events.onStatus('Animation stopped');
  };

  const originalCaptureState = editor.captureState.bind(editor);
  editor.captureState = () => ({
    ...originalCaptureState(),
    animations: cloneClips(editor.animations),
  });

  const originalRestoreState = editor.restoreState.bind(editor);
  editor.restoreState = (state) => {
    originalRestoreState(state);
    editor.registerAnimations(state?.animations ?? [], { replace: true });
  };

  const originalRenameSelected = editor.renameSelected.bind(editor);
  editor.renameSelected = (name) => {
    const object = editor.selected;
    const oldName = object?.name ?? '';
    let requested = String(name ?? '').trim();
    if (object && requested && requested !== oldName && nameUsedByOther(editor, object, requested)) {
      requested = editor.uniqueName(requested);
    }
    originalRenameSelected(requested || name);
    const newName = object?.name ?? '';
    if (!oldName || !newName || oldName === newName || !editor.animations.length) return;
    let changed = 0;
    for (const clip of editor.animations) {
      for (const track of clip.tracks) {
        const next = retargetTrackName(track.name, oldName, newName);
        if (next !== track.name) {
          track.name = next;
          changed += 1;
        }
      }
    }
    if (changed) {
      resetMixer();
      emitChanged();
      editor.events.onStatus(`Animation: ${changed} track(s) retargeted ${oldName} → ${newName}`);
    }
  };

  const originalDeleteSelected = editor.deleteSelected.bind(editor);
  editor.deleteSelected = (...args) => {
    const names = namesIn(editor.getTopLevelSelection());
    const result = originalDeleteSelected(...args);
    pruneMissingTargets(names);
    return result;
  };

  const originalJoinSelected = editor.joinSelected.bind(editor);
  editor.joinSelected = (...args) => {
    const names = namesIn(editor.getTopLevelSelection());
    const result = originalJoinSelected(...args);
    if (result !== false) pruneMissingTargets(names);
    return result;
  };

  const originalSeparateSelected = editor.separateSelected.bind(editor);
  editor.separateSelected = (...args) => {
    const names = namesIn(editor.selected ? [editor.selected] : []);
    const result = originalSeparateSelected(...args);
    if (result !== false) pruneMissingTargets(names);
    return result;
  };

  const originalNewScene = editor.newScene.bind(editor);
  editor.newScene = (...args) => {
    const result = originalNewScene(...args);
    editor.clearAnimations();
    return result;
  };

  editor.transform.addEventListener('mouseDown', () => {
    if (activeAction) resetMixer();
  });

  const bar = document.querySelector('.main-menu-bar');
  const spacer = bar?.querySelector('.main-menu-spacer');
  let menu = null;
  if (bar && spacer) {
    menu = document.createElement('details');
    menu.className = 'menu animation-menu';
    menu.innerHTML = `
      <summary>Animation</summary>
      <div class="menu-popover animation-popover">
        <div class="animation-summary" data-animation-summary>No clips</div>
        <div class="animation-clips" data-animation-clips></div>
        <div class="menu-separator"></div>
        <label class="animation-speed"><span>Speed</span><input data-animation-speed type="number" min="0.05" max="4" step="0.05" value="1" /></label>
        <button type="button" data-animation-stop><i data-lucide="square"></i><span>Stop / Reset Pose</span></button>
      </div>`;
    bar.insertBefore(menu, spacer);

    const style = document.createElement('style');
    style.textContent = `
      .animation-popover{min-width:260px}.animation-summary{padding:6px 8px;color:#aaa}.animation-clips{display:grid;gap:2px;max-height:260px;overflow:auto}.animation-clip{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:10px!important}.animation-clip span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.animation-clip small{color:#999}.animation-speed{display:grid;grid-template-columns:60px 1fr;gap:8px;align-items:center;padding:5px 8px}.animation-speed input{width:100%;height:24px;background:#1f1f1f;color:#eee;border:1px solid #4a4a4a;border-radius:3px;padding:2px 5px}`;
    document.head.appendChild(style);

    const render = () => {
      const list = menu.querySelector('[data-animation-clips]');
      const summary = menu.querySelector('[data-animation-summary]');
      list.replaceChildren();
      summary.textContent = editor.animations.length ? `${editor.animations.length} clip(s) preserved in GLB` : 'No animation clips';
      editor.animations.forEach((clip, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'animation-clip';
        const name = document.createElement('span');
        name.textContent = clip.name || `Clip ${index + 1}`;
        const duration = document.createElement('small');
        duration.textContent = `${clip.duration.toFixed(2)}s`;
        button.append(name, duration);
        button.addEventListener('click', () => {
          editor.playAnimation(index);
          menu.removeAttribute('open');
        });
        list.appendChild(button);
      });
      refreshIcons();
    };

    menu.querySelector('[data-animation-stop]').addEventListener('click', () => {
      editor.stopAnimation();
      menu.removeAttribute('open');
    });
    menu.querySelector('[data-animation-speed]').addEventListener('change', (event) => {
      speed = THREE.MathUtils.clamp(Number(event.target.value) || 1, 0.05, 4);
      event.target.value = speed;
    });
    window.addEventListener('gluestack:animations-changed', render);
    render();
  }

  const api = {
    menu,
    get clips() { return editor.animations; },
    get activeClip() { return activeClip; },
    pruneMissingTargets,
    dispose() {
      cancelAnimationFrame(raf);
      resetMixer();
    },
  };
  editor.__gluestackAnimations = api;
  return api;
}
