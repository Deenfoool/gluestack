import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

const INTERPOLATIONS = {
  linear: THREE.InterpolateLinear,
  step: THREE.InterpolateDiscrete,
  smooth: THREE.InterpolateSmooth,
};

function interpolationName(track) {
  const value = track?.getInterpolation?.();
  if (value === THREE.InterpolateDiscrete) return 'step';
  if (value === THREE.InterpolateSmooth) return 'smooth';
  return 'linear';
}

function supportsInterpolation(track, name) {
  if (!track) return false;
  if (name === 'step') return Boolean(track.InterpolantFactoryMethodDiscrete);
  if (name === 'smooth') return Boolean(track.InterpolantFactoryMethodSmooth);
  return Boolean(track.InterpolantFactoryMethodLinear);
}

function cloneTrackWithKeys(track, entries) {
  const size = track.getValueSize();
  const TrackClass = track.constructor;
  const times = entries.map((entry) => entry.time);
  const values = entries.flatMap((entry) => entry.values.slice(0, size));
  const next = new TrackClass(track.name, times, values);
  try { next.setInterpolation(track.getInterpolation()); } catch {}
  return next;
}

function trackEntries(track) {
  const size = track.getValueSize();
  return Array.from(track.times, (time, index) => ({
    time: Number(time),
    values: Array.from(track.values.slice(index * size, index * size + size)),
  }));
}

function clampDuration(clip) {
  if (!clip.tracks.length) {
    clip.duration = Math.max(0.001, Number(clip.duration) || 1);
    return;
  }
  clip.resetDuration();
  clip.duration = Math.max(0.001, clip.duration || 0.001);
}

function keyValueSummary(track, keyIndex) {
  const size = track.getValueSize();
  const start = keyIndex * size;
  const values = Array.from(track.values.slice(start, start + size));
  return values.map((value) => Number(value).toFixed(3)).join(', ');
}

export function installDopeSheet(editor) {
  if (!editor?.__gluestackAnimations || !editor?.__gluestackAnimationEditor) return null;
  if (editor.__gluestackDopeSheet) return editor.__gluestackDopeSheet;

  const animationMenu = document.querySelector('.animation-menu .animation-popover');
  if (!animationMenu) return null;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.dataset.openDopeSheet = '';
  openButton.innerHTML = '<i data-lucide="table-properties"></i><span>Dope Sheet</span>';
  animationMenu.appendChild(openButton);

  const panel = document.createElement('section');
  panel.className = 'dope-sheet';
  panel.hidden = true;
  panel.innerHTML = `
    <header class="dope-header">
      <strong>Dope Sheet</strong>
      <label>Clip <select data-dope-clip></select></label>
      <label>Time <input data-dope-time type="number" min="0" step="0.01" value="0" /></label>
      <label>Interpolation <select data-dope-interpolation><option value="linear">Linear</option><option value="step">Step</option><option value="smooth">Smooth</option></select></label>
      <button type="button" data-dope-delete disabled><i data-lucide="diamond-minus"></i><span>Delete Key</span></button>
      <button type="button" data-dope-close title="Close"><i data-lucide="x"></i></button>
    </header>
    <div class="dope-body">
      <div class="dope-track-list" data-dope-track-list></div>
      <div class="dope-timeline-wrap">
        <div class="dope-ruler" data-dope-ruler></div>
        <div class="dope-rows" data-dope-rows></div>
        <div class="dope-playhead" data-dope-playhead></div>
      </div>
    </div>
    <footer class="dope-footer">
      <span data-dope-selection>No key selected</span>
      <div class="dope-footer-spacer"></div>
      <span>Click ruler to scrub · drag selected key horizontally</span>
    </footer>`;
  document.body.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .dope-sheet{position:fixed;z-index:120;left:48px;right:304px;bottom:23px;height:245px;display:grid;grid-template-rows:34px minmax(0,1fr) 25px;background:#242424;border:1px solid #505050;box-shadow:0 -12px 35px rgba(0,0,0,.38);color:#d5d5d5}.dope-sheet[hidden]{display:none}.dope-header{display:flex;align-items:center;gap:8px;padding:4px 7px;background:#303030;border-bottom:1px solid #171717}.dope-header strong{margin-right:4px}.dope-header label{display:flex;align-items:center;gap:4px;font-size:10px;color:#aaa}.dope-header select,.dope-header input{height:24px;min-width:76px;background:#1f1f1f;color:#eee;border:1px solid #4a4a4a;border-radius:3px;padding:2px 5px}.dope-header button{height:25px;display:flex;align-items:center;gap:4px;border:1px solid #4a4a4a;border-radius:3px;background:#383838;color:#ddd}.dope-header [data-dope-close]{margin-left:auto;width:27px;justify-content:center}.dope-body{min-height:0;display:grid;grid-template-columns:205px minmax(0,1fr)}.dope-track-list{overflow:auto;border-right:1px solid #151515;background:#292929}.dope-track-name{height:27px;display:flex;align-items:center;padding:0 7px;border-bottom:1px solid #363636;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dope-timeline-wrap{position:relative;overflow:auto;background:#202020}.dope-ruler{position:sticky;top:0;z-index:3;height:24px;background:#303030;border-bottom:1px solid #151515;cursor:crosshair}.dope-ruler-tick{position:absolute;top:0;height:100%;border-left:1px solid #555;font-size:9px;color:#aaa;padding-left:3px}.dope-rows{position:relative;min-width:620px}.dope-row{position:relative;height:27px;border-bottom:1px solid #303030;background-image:linear-gradient(to right,rgba(255,255,255,.035) 1px,transparent 1px);background-size:10% 100%}.dope-key{position:absolute;top:8px;width:11px;height:11px;padding:0;border:1px solid #181818;background:#c77a2a;transform:translateX(-50%) rotate(45deg);cursor:ew-resize}.dope-key.selected{background:#ffad3d;box-shadow:0 0 0 2px rgba(255,149,0,.28)}.dope-playhead{position:absolute;z-index:4;top:0;bottom:0;width:1px;background:#ff7043;pointer-events:none}.dope-playhead:before{content:'';position:absolute;top:0;left:-4px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:7px solid #ff7043}.dope-footer{display:flex;align-items:center;padding:0 7px;background:#2d2d2d;border-top:1px solid #151515;font-size:10px;color:#999}.dope-footer-spacer{flex:1}`;
  document.head.appendChild(style);

  const clipSelect = panel.querySelector('[data-dope-clip]');
  const timeInput = panel.querySelector('[data-dope-time]');
  const interpolation = panel.querySelector('[data-dope-interpolation]');
  const deleteButton = panel.querySelector('[data-dope-delete]');
  const trackList = panel.querySelector('[data-dope-track-list]');
  const rows = panel.querySelector('[data-dope-rows]');
  const ruler = panel.querySelector('[data-dope-ruler]');
  const playhead = panel.querySelector('[data-dope-playhead]');
  const selectionLabel = panel.querySelector('[data-dope-selection]');

  let selected = null;
  let currentTime = 0;
  let dragging = null;

  const clipIndex = () => Math.max(0, Number(clipSelect.value) || 0);
  const clip = () => editor.animations?.[clipIndex()] ?? null;
  const duration = () => Math.max(0.001, Number(clip()?.duration) || 1);

  function emitChanged() {
    window.dispatchEvent(new CustomEvent('gluestack:animations-changed', { detail: { clips: editor.animations } }));
  }

  function setTime(time, scrub = true) {
    currentTime = THREE.MathUtils.clamp(Number(time) || 0, 0, duration());
    timeInput.value = currentTime.toFixed(2);
    playhead.style.left = `${(currentTime / duration()) * 100}%`;
    if (scrub) editor.scrubAnimation?.(clipIndex(), currentTime);
  }

  function selectKey(trackIndex, keyIndex) {
    const activeClip = clip();
    const track = activeClip?.tracks?.[trackIndex];
    if (!track || keyIndex < 0 || keyIndex >= track.times.length) {
      selected = null;
      deleteButton.disabled = true;
      selectionLabel.textContent = 'No key selected';
      renderRows();
      return;
    }
    selected = { trackIndex, keyIndex };
    deleteButton.disabled = false;
    currentTime = Number(track.times[keyIndex]);
    timeInput.value = currentTime.toFixed(2);
    interpolation.value = interpolationName(track);
    selectionLabel.textContent = `${track.name} · ${currentTime.toFixed(2)}s · [${keyValueSummary(track, keyIndex)}]`;
    setTime(currentTime, true);
    renderRows();
  }

  function renderRuler() {
    ruler.replaceChildren();
    for (let i = 0; i <= 10; i += 1) {
      const tick = document.createElement('span');
      tick.className = 'dope-ruler-tick';
      tick.style.left = `${i * 10}%`;
      tick.textContent = `${(duration() * i / 10).toFixed(2)}s`;
      ruler.appendChild(tick);
    }
  }

  function renderRows() {
    const activeClip = clip();
    trackList.replaceChildren();
    rows.replaceChildren();
    if (!activeClip) {
      trackList.innerHTML = '<div class="dope-track-name">No animation clips</div>';
      renderRuler();
      return;
    }

    activeClip.tracks.forEach((track, trackIndex) => {
      const name = document.createElement('div');
      name.className = 'dope-track-name';
      name.title = track.name;
      name.textContent = track.name;
      trackList.appendChild(name);

      const row = document.createElement('div');
      row.className = 'dope-row';
      track.times.forEach((time, keyIndex) => {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = `dope-key${selected?.trackIndex === trackIndex && selected?.keyIndex === keyIndex ? ' selected' : ''}`;
        key.style.left = `${THREE.MathUtils.clamp(Number(time) / duration(), 0, 1) * 100}%`;
        key.title = `${Number(time).toFixed(3)}s`;
        key.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectKey(trackIndex, keyIndex);
          dragging = { trackIndex, keyIndex, startX: event.clientX, originalTime: Number(track.times[keyIndex]), checkpointed: false };
          key.setPointerCapture?.(event.pointerId);
        });
        row.appendChild(key);
      });
      rows.appendChild(row);
    });
    renderRuler();
    playhead.style.left = `${(currentTime / duration()) * 100}%`;
  }

  function renderClips() {
    const previousClip = clipIndex();
    const previousSelection = selected ? { ...selected } : null;
    clipSelect.replaceChildren();
    (editor.animations ?? []).forEach((item, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = item.name || `Clip ${index + 1}`;
      clipSelect.appendChild(option);
    });
    clipSelect.disabled = !editor.animations?.length;
    if (editor.animations?.length) clipSelect.value = String(Math.min(previousClip, editor.animations.length - 1));

    if (previousSelection) {
      const track = clip()?.tracks?.[previousSelection.trackIndex];
      if (track && previousSelection.keyIndex < track.times.length) selected = previousSelection;
      else selected = null;
    }
    deleteButton.disabled = !selected;
    if (!selected) selectionLabel.textContent = 'No key selected';
    else {
      const track = clip()?.tracks?.[selected.trackIndex];
      if (track) {
        currentTime = Number(track.times[selected.keyIndex]);
        selectionLabel.textContent = `${track.name} · ${currentTime.toFixed(2)}s · [${keyValueSummary(track, selected.keyIndex)}]`;
        interpolation.value = interpolationName(track);
      }
    }
    setTime(Math.min(currentTime, duration()), false);
    renderRows();
  }

  function moveSelectedKey(nextTime) {
    const activeClip = clip();
    const track = activeClip?.tracks?.[selected?.trackIndex];
    if (!track || selected?.keyIndex == null) return false;
    const entries = trackEntries(track);
    const entry = entries[selected.keyIndex];
    if (!entry) return false;
    entry.time = Math.max(0, Number(nextTime) || 0);
    entries.sort((a, b) => a.time - b.time);
    const newIndex = entries.indexOf(entry);
    activeClip.tracks[selected.trackIndex] = cloneTrackWithKeys(track, entries);
    clampDuration(activeClip);
    selected.keyIndex = newIndex;
    currentTime = entry.time;
    return true;
  }

  function deleteSelectedKey() {
    const activeClip = clip();
    const track = activeClip?.tracks?.[selected?.trackIndex];
    if (!track || selected?.keyIndex == null) return false;
    editor.checkpoint('Delete animation keyframe');
    const entries = trackEntries(track);
    entries.splice(selected.keyIndex, 1);
    if (!entries.length) activeClip.tracks.splice(selected.trackIndex, 1);
    else activeClip.tracks[selected.trackIndex] = cloneTrackWithKeys(track, entries);
    clampDuration(activeClip);
    selected = null;
    deleteButton.disabled = true;
    selectionLabel.textContent = 'No key selected';
    emitChanged();
    renderRows();
    editor.events.onStatus('Animation keyframe удалён');
    return true;
  }

  function applyInterpolation() {
    const activeClip = clip();
    const track = activeClip?.tracks?.[selected?.trackIndex];
    if (!track) return false;
    const mode = interpolation.value;
    if (!supportsInterpolation(track, mode)) {
      interpolation.value = interpolationName(track);
      editor.events.onStatus(`${track.ValueTypeName || track.constructor.name}: interpolation ${mode} не поддерживается`);
      return false;
    }
    editor.checkpoint('Change keyframe interpolation');
    track.setInterpolation(INTERPOLATIONS[mode] ?? THREE.InterpolateLinear);
    emitChanged();
    renderRows();
    editor.events.onStatus(`Interpolation · ${mode}`);
    return true;
  }

  openButton.addEventListener('click', () => {
    panel.hidden = false;
    document.querySelector('.animation-menu')?.removeAttribute('open');
    renderClips();
    refreshIcons();
  });
  panel.querySelector('[data-dope-close]').addEventListener('click', () => { panel.hidden = true; });
  clipSelect.addEventListener('change', () => {
    selected = null;
    currentTime = 0;
    setTime(0, true);
    renderRows();
  });
  timeInput.addEventListener('change', () => {
    const requested = Math.max(0, Number(timeInput.value) || 0);
    if (selected) {
      editor.checkpoint('Move animation keyframe');
      if (moveSelectedKey(requested)) {
        emitChanged();
        renderRows();
        if (selected) selectKey(selected.trackIndex, selected.keyIndex);
      }
    } else setTime(requested, true);
  });
  interpolation.addEventListener('change', applyInterpolation);
  deleteButton.addEventListener('click', deleteSelectedKey);

  ruler.addEventListener('pointerdown', (event) => {
    const rect = ruler.getBoundingClientRect();
    const ratio = THREE.MathUtils.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    setTime(ratio * duration(), true);
  });

  window.addEventListener('pointermove', (event) => {
    if (!dragging || panel.hidden) return;
    const rect = rows.getBoundingClientRect();
    const delta = (event.clientX - dragging.startX) / Math.max(1, rect.width) * duration();
    if (!dragging.checkpointed) {
      editor.checkpoint('Move animation keyframe');
      dragging.checkpointed = true;
    }
    selected = { trackIndex: dragging.trackIndex, keyIndex: dragging.keyIndex };
    if (moveSelectedKey(Math.max(0, dragging.originalTime + delta))) {
      dragging.keyIndex = selected.keyIndex;
      setTime(currentTime, true);
      renderRows();
    }
  }, true);

  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    const changed = dragging.checkpointed;
    const keepSelection = selected ? { ...selected } : null;
    dragging = null;
    if (changed) {
      emitChanged();
      renderRows();
      if (keepSelection) selectKey(keepSelection.trackIndex, keepSelection.keyIndex);
    }
  }, true);

  window.addEventListener('gluestack:animations-changed', () => {
    if (!panel.hidden) renderClips();
  });

  renderClips();
  refreshIcons();
  const api = { panel, render: renderClips, open() { panel.hidden = false; renderClips(); }, close() { panel.hidden = true; } };
  editor.__gluestackDopeSheet = api;
  return api;
}
