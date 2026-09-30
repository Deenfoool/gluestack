import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

const EPSILON = 1e-4;

function uniqueClipName(clips, base = 'Animation') {
  const clean = String(base || 'Animation').trim() || 'Animation';
  const names = new Set(clips.map((clip) => clip?.name).filter(Boolean));
  if (!names.has(clean)) return clean;
  let index = 1;
  let candidate;
  do {
    candidate = `${clean}.${String(index).padStart(3, '0')}`;
    index += 1;
  } while (names.has(candidate));
  return candidate;
}

function replaceTrackKey(track, time, values, TrackClass) {
  const entries = [];
  const size = track.getValueSize();
  for (let i = 0; i < track.times.length; i += 1) {
    entries.push({
      time: Number(track.times[i]),
      values: Array.from(track.values.slice(i * size, i * size + size)),
    });
  }

  const existing = entries.find((entry) => Math.abs(entry.time - time) <= EPSILON);
  if (existing) existing.values = [...values];
  else entries.push({ time, values: [...values] });
  entries.sort((a, b) => a.time - b.time);

  const next = new TrackClass(
    track.name,
    entries.map((entry) => entry.time),
    entries.flatMap((entry) => entry.values),
  );
  if (track.getInterpolation) {
    try { next.setInterpolation(track.getInterpolation()); } catch {}
  }
  return next;
}

function upsertTrack(clip, trackName, time, values, TrackClass) {
  const index = clip.tracks.findIndex((track) => track.name === trackName);
  if (index < 0) {
    clip.tracks.push(new TrackClass(trackName, [time], [...values]));
    return;
  }
  clip.tracks[index] = replaceTrackKey(clip.tracks[index], time, values, TrackClass);
}

function ensureAnimatedName(editor, object) {
  if (object.name) return object.name;
  const name = editor.uniqueName('AnimatedObject');
  object.name = name;
  editor.events.onStructure();
  return name;
}

export function installAnimationEditor(editor) {
  if (!editor?.__gluestackAnimations || editor.__gluestackAnimationEditor) return editor?.__gluestackAnimationEditor ?? null;

  const emitChanged = () => {
    window.dispatchEvent(new CustomEvent('gluestack:animations-changed', { detail: { clips: editor.animations } }));
  };

  let scrubMixer = new THREE.AnimationMixer(editor.modelRoot);
  let scrubAction = null;

  const resetScrub = () => {
    scrubAction?.stop();
    scrubMixer.stopAllAction();
    scrubMixer.uncacheRoot(editor.modelRoot);
    scrubMixer = new THREE.AnimationMixer(editor.modelRoot);
    scrubAction = null;
  };

  editor.createAnimationClip = (name = 'Animation', duration = 1) => {
    editor.checkpoint('Create animation clip');
    const clip = new THREE.AnimationClip(
      uniqueClipName(editor.animations ?? [], name),
      Math.max(0.001, Number(duration) || 1),
      [],
    );
    editor.animations.push(clip);
    resetScrub();
    emitChanged();
    editor.events.onStatus(`Animation clip «${clip.name}» создан`);
    return clip;
  };

  editor.deleteAnimationClip = (index) => {
    const clip = editor.animations?.[index];
    if (!clip) return false;
    editor.checkpoint('Delete animation clip');
    editor.stopAnimation?.();
    editor.animations.splice(index, 1);
    resetScrub();
    emitChanged();
    editor.events.onStatus(`Animation clip «${clip.name || index + 1}» удалён`);
    return true;
  };

  editor.keyframeTransform = (index, time, object = editor.selected) => {
    const clip = editor.animations?.[index];
    if (!clip) {
      editor.events.onStatus('Keyframe: выберите animation clip');
      return false;
    }
    if (!object || object === editor.modelRoot) {
      editor.events.onStatus('Keyframe: выберите объект');
      return false;
    }
    const cleanTime = Math.max(0, Number(time) || 0);
    const name = ensureAnimatedName(editor, object);

    editor.checkpoint(`Keyframe ${name}`);
    upsertTrack(clip, `${name}.position`, cleanTime, object.position.toArray(), THREE.VectorKeyframeTrack);
    upsertTrack(clip, `${name}.quaternion`, cleanTime, object.quaternion.toArray(), THREE.QuaternionKeyframeTrack);
    upsertTrack(clip, `${name}.scale`, cleanTime, object.scale.toArray(), THREE.VectorKeyframeTrack);
    clip.duration = Math.max(Number.isFinite(clip.duration) ? clip.duration : 0, cleanTime, 0.001);
    resetScrub();
    emitChanged();
    editor.events.onStatus(`Keyframe · ${clip.name} · ${name} · ${cleanTime.toFixed(2)}s`);
    return true;
  };

  editor.scrubAnimation = (index, time) => {
    const clip = editor.animations?.[index];
    if (!clip) return false;
    editor.stopAnimation?.();
    resetScrub();
    scrubAction = scrubMixer.clipAction(clip);
    scrubAction.play();
    scrubAction.paused = true;
    const cleanTime = THREE.MathUtils.clamp(Number(time) || 0, 0, Math.max(0, clip.duration || 0));
    scrubMixer.setTime(cleanTime);
    editor.refreshSelectionVisuals();
    editor.events.onTransform(editor.selected);
    return true;
  };

  const menu = document.querySelector('.animation-menu .animation-popover');
  if (!menu) {
    const api = { resetScrub };
    editor.__gluestackAnimationEditor = api;
    return api;
  }

  const section = document.createElement('section');
  section.className = 'animation-keyframe-editor';
  section.innerHTML = `
    <div class="menu-separator"></div>
    <div class="animation-editor-title">Keyframe Editor</div>
    <label><span>Clip</span><select data-animation-edit-clip></select></label>
    <label><span>Time</span><input data-animation-edit-time type="number" min="0" step="0.05" value="0" /></label>
    <input data-animation-scrub type="range" min="0" max="1" step="0.01" value="0" />
    <div class="animation-editor-actions">
      <button type="button" data-animation-new><i data-lucide="plus"></i><span>New Clip</span></button>
      <button type="button" data-animation-key><i data-lucide="diamond-plus"></i><span>Key Transform</span></button>
      <button type="button" data-animation-delete><i data-lucide="trash-2"></i><span>Delete</span></button>
    </div>
    <div class="animation-editor-note">Key Transform записывает Position / Rotation / Scale выбранного объекта.</div>`;
  menu.appendChild(section);

  const style = document.createElement('style');
  style.textContent = `
    .animation-editor-title{padding:5px 8px;font-weight:600;color:#bbb}.animation-keyframe-editor label{display:grid;grid-template-columns:48px 1fr;gap:8px;align-items:center;padding:4px 8px}.animation-keyframe-editor select,.animation-keyframe-editor input[type=number]{width:100%;height:24px;background:#1f1f1f;color:#eee;border:1px solid #4a4a4a;border-radius:3px;padding:2px 5px}.animation-keyframe-editor input[type=range]{width:calc(100% - 16px);margin:5px 8px}.animation-editor-actions{display:grid;grid-template-columns:1fr 1.2fr .8fr;gap:4px;padding:4px 8px}.animation-editor-actions button{padding:4px!important;font-size:11px}.animation-editor-note{padding:4px 8px 7px;color:#888;font-size:10px;line-height:1.3}`;
  document.head.appendChild(style);

  const clipSelect = section.querySelector('[data-animation-edit-clip]');
  const timeInput = section.querySelector('[data-animation-edit-time]');
  const scrub = section.querySelector('[data-animation-scrub]');

  const selectedIndex = () => Math.max(0, Number(clipSelect.value) || 0);
  const syncRange = () => {
    const clip = editor.animations?.[selectedIndex()];
    const duration = Math.max(0.01, Number(clip?.duration) || 1);
    scrub.max = duration;
    timeInput.max = duration;
    if (Number(scrub.value) > duration) scrub.value = duration;
    if (Number(timeInput.value) > duration) timeInput.value = duration;
  };

  const render = () => {
    const previous = selectedIndex();
    clipSelect.replaceChildren();
    (editor.animations ?? []).forEach((clip, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = clip.name || `Clip ${index + 1}`;
      clipSelect.appendChild(option);
    });
    if (!editor.animations?.length) {
      const option = document.createElement('option');
      option.value = '0';
      option.textContent = 'No clips';
      clipSelect.appendChild(option);
      clipSelect.disabled = true;
    } else {
      clipSelect.disabled = false;
      clipSelect.value = String(Math.min(previous, editor.animations.length - 1));
    }
    syncRange();
    refreshIcons();
  };

  clipSelect.addEventListener('change', () => {
    timeInput.value = 0;
    scrub.value = 0;
    syncRange();
    editor.scrubAnimation(selectedIndex(), 0);
  });
  timeInput.addEventListener('change', () => {
    const time = Math.max(0, Number(timeInput.value) || 0);
    scrub.value = Math.min(time, Number(scrub.max));
    editor.scrubAnimation(selectedIndex(), time);
  });
  scrub.addEventListener('input', () => {
    timeInput.value = Number(scrub.value).toFixed(2);
    editor.scrubAnimation(selectedIndex(), Number(scrub.value));
  });
  section.querySelector('[data-animation-new]').addEventListener('click', () => {
    const name = window.prompt('Animation clip name', 'Animation');
    if (name === null) return;
    const duration = Number(window.prompt('Duration, seconds', '1'));
    const clip = editor.createAnimationClip(name, Number.isFinite(duration) ? duration : 1);
    render();
    clipSelect.value = String(editor.animations.indexOf(clip));
    syncRange();
  });
  section.querySelector('[data-animation-key]').addEventListener('click', () => {
    editor.keyframeTransform(selectedIndex(), Number(timeInput.value) || 0);
  });
  section.querySelector('[data-animation-delete]').addEventListener('click', () => {
    if (editor.deleteAnimationClip(selectedIndex())) render();
  });

  window.addEventListener('gluestack:animations-changed', render);
  render();

  const api = { section, resetScrub, render };
  editor.__gluestackAnimationEditor = api;
  return api;
}
