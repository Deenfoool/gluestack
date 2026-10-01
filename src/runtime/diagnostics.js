import * as THREE from 'three';
import { CURRENT_PROJECT_VERSION, PROJECT_FORMAT, normalizeProjectMetadata } from '../projects/format.js';
import { refreshIcons } from '../ui.js';

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

function result(name, ok, detail = '', level = ok ? 'pass' : 'fail') {
  return { name, ok, detail, level };
}

function editorMetadataKeys(userData = {}) {
  return Object.keys(userData).filter((key) => key.startsWith('gluestack') || key.startsWith('__gluestack'));
}

function sceneSignature(root) {
  const textures = new Set();
  const signature = {
    meshes: 0,
    uvMeshes: 0,
    materialSlots: 0,
    materialGroups: 0,
    pbrMaterials: 0,
    textureSlots: 0,
    extrasObjects: 0,
    editorMetadataKeys: 0,
  };

  root?.traverse?.((object) => {
    if (object.userData && Object.keys(object.userData).length) signature.extrasObjects += 1;
    signature.editorMetadataKeys += editorMetadataKeys(object.userData).length;
    if (!object.isMesh) return;
    signature.meshes += 1;
    const position = object.geometry?.getAttribute('position');
    const uv = object.geometry?.getAttribute('uv');
    if (position && uv && uv.count === position.count) signature.uvMeshes += 1;
    signature.materialGroups += object.geometry?.groups?.length ?? 0;

    const materials = Array.isArray(object.material) ? object.material.filter(Boolean) : object.material ? [object.material] : [];
    signature.materialSlots += materials.length;
    for (const material of materials) {
      if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) signature.pbrMaterials += 1;
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (!texture?.isTexture) continue;
        signature.textureSlots += 1;
        textures.add(texture.uuid);
      }
    }
  });

  signature.uniqueTextures = textures.size;
  return signature;
}

function animationSignature(clips = []) {
  return {
    clips: clips.length,
    tracks: clips.reduce((sum, clip) => sum + (clip?.tracks?.length ?? 0), 0),
    duration: clips.reduce((sum, clip) => sum + (Number.isFinite(clip?.duration) ? clip.duration : 0), 0),
  };
}

function signatureDetail(before, after) {
  return [
    `mesh ${before.meshes}→${after.meshes}`,
    `UV ${before.uvMeshes}→${after.uvMeshes}`,
    `slots ${before.materialSlots}→${after.materialSlots}`,
    `groups ${before.materialGroups}→${after.materialGroups}`,
    `PBR ${before.pbrMaterials}→${after.pbrMaterials}`,
    `texture slots ${before.textureSlots}→${after.textureSlots}`,
    `editor keys ${before.editorMetadataKeys}→${after.editorMetadataKeys}`,
  ].join(' · ');
}

function signatureMatches(before, after) {
  return before.meshes === after.meshes
    && before.uvMeshes === after.uvMeshes
    && before.materialSlots === after.materialSlots
    && before.materialGroups === after.materialGroups
    && before.pbrMaterials === after.pbrMaterials
    && before.textureSlots === after.textureSlots
    && before.uniqueTextures === after.uniqueTextures;
}

function animationsMatch(before, after) {
  return before.clips === after.clips
    && before.tracks === after.tracks
    && Math.abs(before.duration - after.duration) < 1e-3;
}

async function exportBuffer(editor) {
  if (editor.exportCleanBuffer) return editor.exportCleanBuffer();
  return new Promise((resolve, reject) => {
    editor.exporter.parse(editor.modelRoot, resolve, reject, {
      binary: true,
      onlyVisible: false,
      trs: false,
      maxTextureSize: 4096,
    });
  });
}

async function parseBuffer(editor, buffer) {
  return new Promise((resolve, reject) => {
    editor.loader.parse(buffer, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

function integrityMatches(expected, actual) {
  const keys = ['meshes', 'materials', 'textures', 'animations', 'modifierStacks'];
  return keys.every((key) => Number(expected?.[key] ?? -1) === Number(actual?.[key] ?? -2));
}

export function installDiagnostics({ editor, projects, features = {} }) {
  const bar = document.querySelector('.main-menu-bar');
  const spacer = bar?.querySelector('.main-menu-spacer');
  if (!bar || !spacer) return null;

  const menu = document.createElement('details');
  menu.className = 'menu diagnostics-menu';
  menu.innerHTML = `
    <summary>Help</summary>
    <div class="menu-popover">
      <button type="button" data-diagnostics-run><i data-lucide="stethoscope"></i><span>Run Diagnostics</span></button>
    </div>`;
  bar.insertBefore(menu, spacer);

  const overlay = document.createElement('div');
  overlay.className = 'diagnostics-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="diagnostics-dialog" role="dialog" aria-modal="true" aria-label="gluestack diagnostics">
      <header><strong>gluestack Diagnostics</strong><button type="button" data-diagnostics-close aria-label="Close"><i data-lucide="x"></i></button></header>
      <div class="diagnostics-summary" data-diagnostics-summary>Not run</div>
      <div class="diagnostics-results" data-diagnostics-results></div>
      <footer>
        <button type="button" data-diagnostics-copy><i data-lucide="copy"></i><span>Copy Report</span></button>
        <button type="button" data-diagnostics-again><i data-lucide="refresh-cw"></i><span>Run Again</span></button>
      </footer>
    </section>`;
  document.body.appendChild(overlay);

  const style = document.createElement('style');
  style.textContent = `
    .diagnostics-overlay{position:fixed;z-index:1000;inset:0;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:24px}.diagnostics-overlay[hidden]{display:none}.diagnostics-dialog{width:min(760px,96vw);max-height:min(780px,90vh);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;background:#252525;border:1px solid #555;border-radius:6px;box-shadow:0 18px 55px rgba(0,0,0,.55);overflow:hidden}.diagnostics-dialog header,.diagnostics-dialog footer{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#303030}.diagnostics-dialog header{border-bottom:1px solid #181818}.diagnostics-dialog header button{margin-left:auto}.diagnostics-dialog button{min-height:27px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #4c4c4c;border-radius:3px;background:#383838;color:#ddd}.diagnostics-dialog button:hover{background:#4a4a4a}.diagnostics-summary{padding:9px 11px;color:#bbb;border-bottom:1px solid #3d3d3d}.diagnostics-results{overflow:auto;padding:8px 11px;display:grid;gap:5px}.diagnostics-row{display:grid;grid-template-columns:62px minmax(150px,.8fr) minmax(0,1.4fr);gap:8px;align-items:start;padding:6px 7px;background:#202020;border-radius:3px}.diagnostics-row .badge{font-weight:700}.diagnostics-row.pass .badge{color:#73bf76}.diagnostics-row.warn .badge{color:#d6a047}.diagnostics-row.fail .badge{color:#df6868}.diagnostics-row .detail{color:#a5a5a5;word-break:break-word}.diagnostics-dialog footer{border-top:1px solid #181818;justify-content:flex-end}`;
  document.head.appendChild(style);

  let lastResults = [];

  async function run() {
    overlay.hidden = false;
    menu.removeAttribute('open');
    const summary = overlay.querySelector('[data-diagnostics-summary]');
    const container = overlay.querySelector('[data-diagnostics-results]');
    summary.textContent = 'Running…';
    container.replaceChildren();
    const checks = [];

    checks.push(result('Three.js revision', THREE.REVISION === '180', `r${THREE.REVISION}`, THREE.REVISION === '180' ? 'pass' : 'warn'));
    checks.push(result('Renderer', Boolean(editor.renderer?.domElement?.isConnected), editor.renderer?.domElement?.isConnected ? 'WebGL canvas connected' : 'Renderer canvas missing'));
    checks.push(result('Scene root', Boolean(editor.modelRoot?.parent), `${editor.modelRoot?.children?.length ?? 0} top-level object(s)`));

    const requiredFeatures = [
      'resources', 'animations', 'cleanExport', 'animationEditor', 'dopeSheet', 'importer', 'modifierStack',
      'uv', 'materials', 'projects', 'gameReady', 'integrity', 'paint', 'procedural', 'scene', 'hardening', 'viewportHistory',
    ];
    for (const key of requiredFeatures) {
      checks.push(result(`Feature: ${key}`, Boolean(features[key]), features[key] ? 'installed' : 'not installed'));
    }

    const selected = editor.selected;
    if (selected?.isMesh) {
      const position = selected.geometry?.getAttribute('position');
      const uv = selected.geometry?.getAttribute('uv');
      const materialSlots = Array.isArray(selected.material) ? selected.material.length : selected.material ? 1 : 0;
      checks.push(result('Selected mesh geometry', Boolean(position?.count >= 3), `${position?.count ?? 0} position vertices`));
      checks.push(result('Selected mesh UV', Boolean(uv && uv.count === position?.count), uv ? `${uv.count} UV corners/vertices` : 'No UV attribute', uv ? 'pass' : 'warn'));
      checks.push(result('Selected material groups', true, `${materialSlots} slot(s) · ${selected.geometry?.groups?.length ?? 0} group(s)`, materialSlots > 1 ? 'pass' : 'warn'));
    } else {
      checks.push(result('Selected mesh', true, 'No Mesh selected — mesh-specific checks skipped', 'warn'));
    }

    try {
      const before = sceneSignature(editor.modelRoot);
      const beforeAnimations = animationSignature(editor.animations ?? []);
      const buffer = await exportBuffer(editor);
      const gltf = await parseBuffer(editor, buffer);
      const after = sceneSignature(gltf.scene);
      const afterAnimations = animationSignature(gltf.animations ?? []);
      const dataMatch = signatureMatches(before, after);
      const animationMatch = animationsMatch(beforeAnimations, afterAnimations);
      checks.push(result('GLB export → parse', after.meshes === before.meshes, `${buffer.byteLength.toLocaleString()} bytes · meshes ${before.meshes} → ${after.meshes}`, after.meshes === before.meshes ? 'pass' : 'fail'));
      checks.push(result('GLB data round-trip', dataMatch, signatureDetail(before, after), dataMatch ? 'pass' : 'fail'));
      checks.push(result('Clean GLB editor metadata', after.editorMetadataKeys === 0, `${after.editorMetadataKeys} gluestack* key(s) after export`, after.editorMetadataKeys === 0 ? 'pass' : 'fail'));
      checks.push(result(
        'GLB animation round-trip',
        animationMatch,
        `clips ${beforeAnimations.clips}→${afterAnimations.clips} · tracks ${beforeAnimations.tracks}→${afterAnimations.tracks} · duration ${beforeAnimations.duration.toFixed(2)}→${afterAnimations.duration.toFixed(2)}s`,
        animationMatch ? 'pass' : 'fail',
      ));
    } catch (error) {
      checks.push(result('GLB export → parse', false, error.message || String(error)));
      checks.push(result('GLB data round-trip', false, 'Export/parse did not complete'));
      checks.push(result('Clean GLB editor metadata', false, 'Export/parse did not complete'));
      checks.push(result('GLB animation round-trip', false, 'Export/parse did not complete'));
    }

    if (projects) {
      checks.push(result('Project dirty state', typeof projects.dirty === 'boolean', `dirty=${String(projects.dirty)} · autosave generation ${projects.autosaveGeneration ?? '?'}`));
      try {
        await projects.dbPromise;
        checks.push(result('IndexedDB', true, 'project database opened'));
      } catch (error) {
        checks.push(result('IndexedDB', false, error.message || String(error)));
      }

      try {
        const buffer = await projects.encodeProject();
        const decoded = projects.decodeProject(buffer);
        const metadata = decoded.metadata ?? {};
        const baseValid = metadata.format === PROJECT_FORMAT
          && metadata.version === CURRENT_PROJECT_VERSION
          && decoded.glb?.byteLength > 20;
        const metadataValid = Boolean(
          metadata.camera
          && metadata.selection
          && metadata.editor
          && metadata.viewport
          && metadata.integrity
          && Number.isFinite(metadata.camera.fov)
          && typeof metadata.editor.snapEnabled === 'boolean'
        );
        const expectedIntegrity = projects.integritySummary();
        const projectIntegrity = integrityMatches(expectedIntegrity, metadata.integrity);
        checks.push(result('.gluestack encode/decode', baseValid, `v${metadata.version ?? '?'} · ${buffer.byteLength.toLocaleString()} bytes`));
        checks.push(result('.gluestack editor metadata', metadataValid, metadataValid ? 'camera · selection · editor · viewport · integrity present' : 'missing editor metadata'));
        checks.push(result('.gluestack integrity summary', projectIntegrity, `mesh ${metadata.integrity?.meshes ?? '?'} · materials ${metadata.integrity?.materials ?? '?'} · textures ${metadata.integrity?.textures ?? '?'} · animations ${metadata.integrity?.animations ?? '?'} · stacks ${metadata.integrity?.modifierStacks ?? '?'}`));

        const parsed = await parseBuffer(editor, decoded.glb);
        const beforeAnimations = animationSignature(editor.animations ?? []);
        const afterAnimations = animationSignature(parsed.animations ?? []);
        const projectAnimations = animationsMatch(beforeAnimations, afterAnimations);
        checks.push(result('.gluestack animation payload', projectAnimations, `clips ${beforeAnimations.clips}→${afterAnimations.clips} · tracks ${beforeAnimations.tracks}→${afterAnimations.tracks}`));

        const corrupted = buffer.slice(0);
        new Uint8Array(corrupted)[0] ^= 0xff;
        let corruptionRejected = false;
        try { projects.decodeProject(corrupted); } catch { corruptionRejected = true; }
        checks.push(result('.gluestack corrupted header reject', corruptionRejected, corruptionRejected ? 'corrupted container rejected before scene load' : 'corrupted container was accepted'));

        let newerRejected = false;
        try {
          normalizeProjectMetadata({ ...metadata, version: CURRENT_PROJECT_VERSION + 1 });
        } catch {
          newerRejected = true;
        }
        checks.push(result('.gluestack newer version reject', newerRejected, newerRejected ? `v${CURRENT_PROJECT_VERSION + 1} rejected` : 'newer version accepted unexpectedly'));
      } catch (error) {
        checks.push(result('.gluestack encode/decode', false, error.message || String(error)));
        checks.push(result('.gluestack editor metadata', false, 'encode/decode did not complete'));
        checks.push(result('.gluestack integrity summary', false, 'encode/decode did not complete'));
        checks.push(result('.gluestack animation payload', false, 'encode/decode did not complete'));
        checks.push(result('.gluestack corrupted header reject', false, 'encode/decode did not complete'));
        checks.push(result('.gluestack newer version reject', false, 'encode/decode did not complete'));
      }
    }

    lastResults = checks;
    for (const check of checks) {
      const row = document.createElement('div');
      row.className = `diagnostics-row ${check.level}`;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = check.level === 'pass' ? 'PASS' : check.level === 'warn' ? 'WARN' : 'FAIL';
      const name = document.createElement('strong');
      name.textContent = check.name;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = check.detail;
      row.append(badge, name, detail);
      container.appendChild(row);
    }

    const failed = checks.filter((check) => check.level === 'fail').length;
    const warned = checks.filter((check) => check.level === 'warn').length;
    summary.textContent = failed ? `${failed} failed · ${warned} warning(s)` : `All critical checks passed · ${warned} warning(s)`;
    editor.events.onStatus(failed ? `Diagnostics: ${failed} FAIL` : 'Diagnostics: PASS');
    console.table(checks);
    refreshIcons();
    return checks;
  }

  function reportText() {
    const lines = [`gluestack Diagnostics · ${new Date().toISOString()}`];
    for (const check of lastResults) lines.push(`[${check.level.toUpperCase()}] ${check.name}: ${check.detail}`);
    return lines.join('\n');
  }

  menu.querySelector('[data-diagnostics-run]').addEventListener('click', run);
  overlay.querySelector('[data-diagnostics-close]').addEventListener('click', () => { overlay.hidden = true; });
  overlay.querySelector('[data-diagnostics-again]').addEventListener('click', run);
  overlay.querySelector('[data-diagnostics-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(reportText());
      editor.events.onStatus('Diagnostics report скопирован');
    } catch {
      editor.events.onStatus('Не удалось скопировать report');
    }
  });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.hidden = true; });
  window.addEventListener('keydown', (event) => {
    if (!overlay.hidden && event.code === 'Escape') overlay.hidden = true;
  });

  window.__gluestackDiagnostics = { run };
  refreshIcons();
  return { menu, overlay, run };
}
