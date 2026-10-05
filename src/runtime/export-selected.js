import { restoreSourceLayers } from '../edit/component-visibility.js';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeRootUserData } from './metadata-policy.js';
import { refreshIcons } from '../ui.js';

function safeName(value) {
  return String(value || 'selection').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 96) || 'selection';
}

function download(buffer, filename) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function topLevelSelection(editor) {
  return editor.getTopLevelSelection().filter((object) => object && object !== editor.modelRoot);
}

function selectionNames(objects) {
  const names = new Set();
  for (const object of objects) object.traverse((node) => { if (node.name) names.add(node.name); });
  return names;
}

function trackTargetsSelection(track, names) {
  const name = String(track?.name ?? '');
  for (const target of names) {
    if (name === target || name.startsWith(`${target}.`) || name.includes(`.bones[${target}]`)) return true;
  }
  return false;
}

function filteredAnimations(editor, objects) {
  const names = selectionNames(objects);
  const clips = [];
  for (const clip of editor.animations ?? []) {
    const tracks = (clip.tracks ?? []).filter((track) => trackTargetsSelection(track, names)).map((track) => track.clone());
    if (!tracks.length) continue;
    clips.push(new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode));
  }
  return clips;
}

function makeExportRoot(editor, objects) {
  const root = new THREE.Group();
  root.name = 'Selection';
  for (const source of objects) {
    source.updateWorldMatrix(true, true);
    const clone = cloneSkeleton(source);
    restoreSourceLayers(source, clone);
    source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.updateMatrix();
    root.add(clone);
  }
  sanitizeRootUserData(root, 'runtime');
  return root;
}

function exportRoot(root, animations, maxTextureSize) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => exporter.parse(root, resolve, reject, {
    binary: true,
    onlyVisible: false,
    trs: false,
    maxTextureSize,
    animations,
  }));
}

export function installExportSelected({ editor }) {
  if (!editor || editor.exportSelectedGlb) return editor?.__gluestackExportSelected ?? null;
  const menu = document.querySelector('#file-menu .menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.exportSelected = '';
  button.innerHTML = '<i data-lucide="package-open"></i><span>Export Selected GLB</span>';
  const exportButton = menu.querySelector('[data-action="export"]');
  exportButton?.insertAdjacentElement('afterend', button);

  async function exportSelected(filename = null) {
    const objects = topLevelSelection(editor);
    if (!objects.length) throw new Error('Нет выбранных объектов');
    let hasSkinned = false;
    for (const object of objects) object.traverse((node) => { if (node.isSkinnedMesh) hasSkinned = true; });
    if (hasSkinned) throw new Error('Export Selected: SkinnedMesh subset требует отдельного skeleton-safe export pipeline');

    const root = makeExportRoot(editor, objects);
    const animations = filteredAnimations(editor, objects);
    const maxTextureSize = Math.max(128, Number(editor.exportProfile?.maxTextureSize ?? 4096) || 4096);
    const data = await exportRoot(root, animations, maxTextureSize);
    const base = filename ?? `${safeName(editor.selected?.name || objects[0]?.name || 'selection')}.glb`;
    download(data, base);
    editor.events.onStatus(`Export Selected · ${objects.length} root object(s) · animations ${animations.length}`);
    return data;
  }

  button.addEventListener('click', async () => {
    document.querySelector('#file-menu')?.removeAttribute('open');
    try { await exportSelected(); }
    catch (error) {
      console.error('[gluestack] export selected failed', error);
      editor.events.onStatus(`Export Selected: ${error.message || error}`);
    }
  });

  const api = { button, exportSelected };
  editor.exportSelectedGlb = exportSelected;
  editor.__gluestackExportSelected = api;
  refreshIcons();
  return api;
}
