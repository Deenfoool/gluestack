import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

function result(name, ok, detail = '', level = ok ? 'pass' : 'fail') {
  return { name, ok, detail, level };
}

function countMeshes(root) {
  let count = 0;
  root?.traverse?.((object) => { if (object.isMesh) count += 1; });
  return count;
}

async function exportBuffer(editor) {
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
    .diagnostics-overlay{position:fixed;z-index:1000;inset:0;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:24px}.diagnostics-overlay[hidden]{display:none}.diagnostics-dialog{width:min(720px,96vw);max-height:min(760px,90vh);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;background:#252525;border:1px solid #555;border-radius:6px;box-shadow:0 18px 55px rgba(0,0,0,.55);overflow:hidden}.diagnostics-dialog header,.diagnostics-dialog footer{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#303030}.diagnostics-dialog header{border-bottom:1px solid #181818}.diagnostics-dialog header button{margin-left:auto}.diagnostics-dialog button{min-height:27px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #4c4c4c;border-radius:3px;background:#383838;color:#ddd}.diagnostics-dialog button:hover{background:#4a4a4a}.diagnostics-summary{padding:9px 11px;color:#bbb;border-bottom:1px solid #3d3d3d}.diagnostics-results{overflow:auto;padding:8px 11px;display:grid;gap:5px}.diagnostics-row{display:grid;grid-template-columns:62px minmax(130px,.8fr) minmax(0,1.4fr);gap:8px;align-items:start;padding:6px 7px;background:#202020;border-radius:3px}.diagnostics-row .badge{font-weight:700}.diagnostics-row.pass .badge{color:#73bf76}.diagnostics-row.warn .badge{color:#d6a047}.diagnostics-row.fail .badge{color:#df6868}.diagnostics-row .detail{color:#a5a5a5;word-break:break-word}.diagnostics-dialog footer{border-top:1px solid #181818;justify-content:flex-end}`;
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

    const requiredFeatures = ['uv', 'materials', 'projects', 'gameReady', 'paint', 'procedural', 'scene'];
    for (const key of requiredFeatures) {
      checks.push(result(`Feature: ${key}`, Boolean(features[key]), features[key] ? 'installed' : 'not installed'));
    }

    const selected = editor.selected;
    if (selected?.isMesh) {
      const position = selected.geometry?.getAttribute('position');
      const uv = selected.geometry?.getAttribute('uv');
      checks.push(result('Selected mesh geometry', Boolean(position?.count >= 3), `${position?.count ?? 0} position vertices`));
      checks.push(result('Selected mesh UV', Boolean(uv && uv.count === position?.count), uv ? `${uv.count} UV corners/vertices` : 'No UV attribute', uv ? 'pass' : 'warn'));
    } else {
      checks.push(result('Selected mesh', true, 'No Mesh selected — mesh-specific checks skipped', 'warn'));
    }

    try {
      const buffer = await exportBuffer(editor);
      const gltf = await parseBuffer(editor, buffer);
      const before = countMeshes(editor.modelRoot);
      const after = countMeshes(gltf.scene);
      checks.push(result('GLB export → parse', after === before, `${buffer.byteLength.toLocaleString()} bytes · meshes ${before} → ${after}`, after === before ? 'pass' : 'fail'));
    } catch (error) {
      checks.push(result('GLB export → parse', false, error.message || String(error)));
    }

    if (projects) {
      try {
        await projects.dbPromise;
        checks.push(result('IndexedDB', true, 'project database opened'));
      } catch (error) {
        checks.push(result('IndexedDB', false, error.message || String(error)));
      }

      try {
        const buffer = await projects.encodeProject();
        const decoded = projects.decodeProject(buffer);
        const valid = decoded.metadata?.format === 'gluestack-project' && decoded.glb?.byteLength > 20;
        checks.push(result('.gluestack encode/decode', valid, `v${decoded.metadata?.version ?? '?'} · ${buffer.byteLength.toLocaleString()} bytes`));
      } catch (error) {
        checks.push(result('.gluestack encode/decode', false, error.message || String(error)));
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
