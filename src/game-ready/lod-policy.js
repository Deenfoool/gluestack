import * as THREE from 'three';
import { createCleanExportRoot } from '../runtime/export-clean.js';
import { refreshIcons } from '../ui.js';

function triangleCount(mesh) {
  const position = mesh?.geometry?.getAttribute('position');
  if (!position) return 0;
  return Math.floor((mesh.geometry.index?.count ?? position.count) / 3);
}

function baseNameOf(mesh) {
  return mesh?.userData?.gluestackLOD?.group
    ?? mesh?.userData?.lod?.group
    ?? String(mesh?.name || 'Mesh').replace(/_LOD\d+$/i, '');
}

function lodLevel(mesh) {
  const value = mesh?.userData?.gluestackLOD?.level ?? mesh?.userData?.lod?.level;
  if (Number.isFinite(value)) return Number(value);
  const match = String(mesh?.name ?? '').match(/_LOD(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function chainFor(mesh) {
  if (!mesh?.isMesh) return [];
  const parent = mesh.parent;
  const group = baseNameOf(mesh);
  if (!parent) return [mesh];
  return parent.children
    .filter((object) => object.isMesh && baseNameOf(object) === group && lodLevel(object) !== null)
    .sort((a, b) => lodLevel(a) - lodLevel(b));
}

function cleanRuntimeUserData(userData = {}) {
  return Object.fromEntries(Object.entries(userData).filter(([key]) => !key.startsWith('gluestack') && !key.startsWith('__gluestack')));
}

function cleanObjectData(root) {
  root.traverse((object) => { object.userData = cleanRuntimeUserData(object.userData ?? {}); });
  return root;
}

function safeFileName(value) {
  return String(value || 'model').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 100) || 'model';
}

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRoot(editor, root, animations = editor.animations ?? []) {
  return new Promise((resolve, reject) => {
    editor.exporter.parse(root, resolve, reject, {
      binary: true,
      onlyVisible: false,
      trs: false,
      maxTextureSize: 4096,
      animations,
    });
  });
}

function boundsSanity(source, lod) {
  source.geometry.computeBoundingBox();
  lod.geometry.computeBoundingBox();
  const a = source.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
  const b = lod.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
  const axes = ['x', 'y', 'z'];
  let maxRelative = 0;
  for (const axis of axes) {
    const base = Math.max(1e-5, Math.abs(a[axis]));
    maxRelative = Math.max(maxRelative, Math.abs(b[axis] - a[axis]) / base);
  }
  return maxRelative;
}

function chainSanity(source, chain) {
  const warnings = [];
  const sourceUV = Boolean(source.geometry.getAttribute('uv'));
  for (const lod of chain.slice(1)) {
    if (triangleCount(lod) >= triangleCount(source)) warnings.push(`${lod.name}: triangle count не уменьшился`);
    if (sourceUV && !lod.geometry.getAttribute('uv')) warnings.push(`${lod.name}: потерян UV0`);
    if (!lod.geometry.getAttribute('normal')) warnings.push(`${lod.name}: отсутствуют normals`);
    const boundsError = boundsSanity(source, lod);
    if (boundsError > 0.1) warnings.push(`${lod.name}: bounds отличаются на ${(boundsError * 100).toFixed(1)}%`);
  }
  return warnings;
}

export function installLODPolicy({ editor, gameReady }) {
  const controller = gameReady?.controller;
  const panel = gameReady?.panel;
  if (!editor || !controller || !panel || controller.__lodPolicy) return controller?.__lodPolicy ?? null;

  const policy = {
    ratios: [0.5, 0.25],
    triangleFloor: 24,
    replaceExisting: false,
    coverage: [0.5, 0.2],
    distances: [20, 50],
  };

  const originalGenerate = controller.generateLOD.bind(controller);

  function hasExistingChain(source) {
    return chainFor(source).some((mesh) => mesh !== source && (lodLevel(mesh) ?? 0) > 0);
  }

  function applyRuntimeMetadata(source, chain) {
    const group = baseNameOf(source);
    chain.forEach((mesh, index) => {
      const level = lodLevel(mesh) ?? index;
      const ratio = level === 0 ? 1 : policy.ratios[level - 1] ?? mesh.userData?.gluestackLOD?.ratio ?? 1;
      mesh.userData.lod = {
        version: 1,
        group,
        level,
        ratio,
        screenCoverage: level === 0 ? 1 : policy.coverage[level - 1] ?? null,
        distanceHint: level === 0 ? 0 : policy.distances[level - 1] ?? null,
      };
    });
  }

  function generate(ratios = policy.ratios) {
    const source = editor.selected;
    if (!source?.isMesh) {
      controller.status('LOD: выберите Mesh / LOD0');
      return false;
    }
    if (source.userData?.gluestackLODSkip) {
      controller.status('LOD: объект помечен Skip LOD');
      return false;
    }
    const level = lodLevel(source);
    if (level !== null && level > 0) {
      controller.status('LOD: выберите LOD0, а не сниженный уровень');
      return false;
    }
    const triangles = triangleCount(source);
    if (triangles <= policy.triangleFloor) {
      controller.status(`LOD: ${triangles} triangles ≤ floor ${policy.triangleFloor}`);
      return false;
    }
    if (hasExistingChain(source) && !policy.replaceExisting) {
      controller.status('LOD chain уже существует · включите Replace Existing');
      return false;
    }

    const clean = ratios
      .map((ratio) => THREE.MathUtils.clamp(Number(ratio) || 0, 0.05, 0.95))
      .filter((ratio) => ratio > 0 && ratio < 1)
      .sort((a, b) => b - a);
    if (!clean.length) return false;

    const ok = originalGenerate(clean);
    if (!ok) return false;
    const chain = chainFor(source);
    applyRuntimeMetadata(source, chain);
    const warnings = chainSanity(source, chain);
    source.userData.gluestackLODPolicy = {
      ratios: [...clean],
      triangleFloor: policy.triangleFloor,
      replaceExisting: policy.replaceExisting,
      coverage: [...policy.coverage],
      distances: [...policy.distances],
      warnings,
    };
    editor.events.onStructure();
    controller.status(warnings.length
      ? `LOD создан · ${warnings.length} sanity warning(s)`
      : `LOD policy · ${chain.length} level(s) · sanity OK`);
    renderState();
    return true;
  }

  controller.generateLOD = generate;

  const card = document.createElement('div');
  card.className = 'game-ready-card lod-policy-card';
  card.innerHTML = `
    <div class="game-ready-title"><i data-lucide="list-filter"></i><span>LOD Policy</span></div>
    <div class="lod-policy-grid">
      <label><span>LOD1 ratio</span><input data-lod-policy="ratio1" type="number" min="0.05" max="0.95" step="0.05" value="0.5"></label>
      <label><span>LOD2 ratio</span><input data-lod-policy="ratio2" type="number" min="0.05" max="0.95" step="0.05" value="0.25"></label>
      <label><span>Triangle floor</span><input data-lod-policy="floor" type="number" min="4" step="1" value="24"></label>
      <label><span>LOD1 coverage</span><input data-lod-policy="coverage1" type="number" min="0" max="1" step="0.05" value="0.5"></label>
      <label><span>LOD2 coverage</span><input data-lod-policy="coverage2" type="number" min="0" max="1" step="0.05" value="0.2"></label>
      <label><span>LOD1 distance</span><input data-lod-policy="distance1" type="number" min="0" step="1" value="20"></label>
      <label><span>LOD2 distance</span><input data-lod-policy="distance2" type="number" min="0" step="1" value="50"></label>
      <label class="lod-policy-check"><input data-lod-policy="replace" type="checkbox"><span>Replace Existing</span></label>
    </div>
    <div class="lod-policy-actions">
      <button type="button" data-lod-action="generate">Generate / Replace LOD Chain</button>
      <button type="button" data-lod-action="skip">Toggle Skip Selected</button>
    </div>
    <div class="lod-policy-actions three">
      <button type="button" data-lod-export="all">Export All LODs</button>
      <button type="button" data-lod-export="lod0">Export LOD0 Only</button>
      <button type="button" data-lod-export="individual">Export Chain Files</button>
    </div>
    <div class="game-ready-note" data-lod-state>No LOD policy on selected object.</div>`;
  panel.appendChild(card);

  const style = document.createElement('style');
  style.textContent = `
    .lod-policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.lod-policy-grid label{display:grid;grid-template-columns:minmax(0,1fr) 76px;align-items:center;gap:5px;font-size:10px;color:#aaa}.lod-policy-grid input{min-width:0;height:24px;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.lod-policy-grid .lod-policy-check{grid-column:1/-1;display:flex}.lod-policy-actions{display:grid;grid-template-columns:1.4fr 1fr;gap:4px;margin-top:6px}.lod-policy-actions.three{grid-template-columns:repeat(3,1fr)}.lod-policy-actions button{min-height:27px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.lod-policy-actions button:hover{background:#484848}`;
  document.head.appendChild(style);

  function readPolicy() {
    policy.ratios = [
      Number(card.querySelector('[data-lod-policy="ratio1"]').value) || 0.5,
      Number(card.querySelector('[data-lod-policy="ratio2"]').value) || 0.25,
    ];
    policy.triangleFloor = Math.max(4, Math.floor(Number(card.querySelector('[data-lod-policy="floor"]').value) || 24));
    policy.coverage = [
      THREE.MathUtils.clamp(Number(card.querySelector('[data-lod-policy="coverage1"]').value) || 0.5, 0, 1),
      THREE.MathUtils.clamp(Number(card.querySelector('[data-lod-policy="coverage2"]').value) || 0.2, 0, 1),
    ];
    policy.distances = [
      Math.max(0, Number(card.querySelector('[data-lod-policy="distance1"]').value) || 20),
      Math.max(0, Number(card.querySelector('[data-lod-policy="distance2"]').value) || 50),
    ];
    policy.replaceExisting = card.querySelector('[data-lod-policy="replace"]').checked;
  }

  function renderState() {
    const source = editor.selected;
    const output = card.querySelector('[data-lod-state]');
    if (!source?.isMesh) {
      output.textContent = 'Select Mesh / LOD0.';
      return;
    }
    const chain = chainFor(source);
    const skip = Boolean(source.userData?.gluestackLODSkip);
    const warnings = source.userData?.gluestackLODPolicy?.warnings ?? [];
    output.textContent = `${skip ? 'SKIP · ' : ''}${chain.length > 1 ? `${chain.length} LOD levels` : 'No generated chain'}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}`;
  }

  async function exportAll() {
    const buffer = await editor.exportCleanBuffer();
    downloadBuffer(buffer, 'model-lods.glb');
    controller.status('Exported all LODs');
  }

  async function exportLOD0Only() {
    const root = createCleanExportRoot(editor);
    const remove = [];
    root.traverse((object) => {
      if (!object.isMesh) return;
      const level = Number(object.userData?.lod?.level ?? String(object.name).match(/_LOD(\d+)$/i)?.[1] ?? 0);
      if (level > 0) remove.push(object);
    });
    remove.forEach((object) => object.parent?.remove(object));
    const buffer = await exportRoot(editor, root);
    downloadBuffer(buffer, 'model-lod0.glb');
    controller.status(`Exported LOD0 only · removed ${remove.length} lower LOD(s)`);
  }

  async function exportIndividual() {
    const selected = editor.selected;
    if (!selected?.isMesh) throw new Error('Выберите LOD0 Mesh');
    const chain = chainFor(selected);
    if (chain.length < 2) throw new Error('У выбранного Mesh нет LOD chain');
    for (const source of chain) {
      source.updateWorldMatrix(true, false);
      const clone = cleanObjectData(source.clone(true));
      clone.parent?.remove(clone);
      source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
      clone.updateMatrix();
      const buffer = await exportRoot(editor, clone, []);
      downloadBuffer(buffer, `${safeFileName(source.name)}.glb`);
    }
    controller.status(`Exported ${chain.length} individual LOD file(s)`);
  }

  card.querySelectorAll('[data-lod-policy]').forEach((input) => input.addEventListener('change', readPolicy));
  card.querySelector('[data-lod-action="generate"]').addEventListener('click', () => { readPolicy(); generate(); });
  card.querySelector('[data-lod-action="skip"]').addEventListener('click', () => {
    const object = editor.selected;
    if (!object?.isMesh) return;
    editor.checkpoint('Toggle LOD skip');
    object.userData.gluestackLODSkip = !object.userData.gluestackLODSkip;
    editor.events.onStructure();
    renderState();
    controller.status(object.userData.gluestackLODSkip ? 'LOD Skip включён' : 'LOD Skip выключен');
  });
  card.querySelector('[data-lod-export="all"]').addEventListener('click', () => exportAll().catch((error) => controller.status(`LOD export: ${error.message || error}`)));
  card.querySelector('[data-lod-export="lod0"]').addEventListener('click', () => exportLOD0Only().catch((error) => controller.status(`LOD export: ${error.message || error}`)));
  card.querySelector('[data-lod-export="individual"]').addEventListener('click', () => exportIndividual().catch((error) => controller.status(`LOD export: ${error.message || error}`)));

  const previousSelection = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelection(...args);
    renderState();
  };

  const api = { policy, generate, chainFor: () => chainFor(editor.selected), exportAll, exportLOD0Only, exportIndividual, render: renderState };
  controller.__lodPolicy = api;
  renderState();
  refreshIcons();
  return api;
}
