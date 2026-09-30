import { refreshIcons } from '../ui.js';
import { GameReadyController } from './controller.js';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function installGameReady({ editor }) {
  const tabs = document.querySelector('.properties-tabs');
  const content = document.querySelector('.properties-content');
  if (!tabs || !content) return null;

  const controller = new GameReadyController(editor);
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'property-tab';
  tab.dataset.gameReadyTab = '';
  tab.title = 'Game Ready';
  tab.innerHTML = '<i data-lucide="badge-check"></i>';
  tabs.appendChild(tab);

  const panel = document.createElement('div');
  panel.id = 'game-ready-properties';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="game-ready-card">
      <div class="game-ready-title"><i data-lucide="activity"></i><span>Game Ready</span></div>
      <div class="game-ready-metrics">
        <div><span>Meshes</span><strong data-gr="meshes">—</strong></div>
        <div><span>Vertices</span><strong data-gr="vertices">—</strong></div>
        <div><span>Triangles</span><strong data-gr="triangles">—</strong></div>
        <div><span>Materials</span><strong data-gr="materials">—</strong></div>
        <div><span>Textures</span><strong data-gr="textures">—</strong></div>
        <div><span>Texture RAM</span><strong data-gr="texture-mb">—</strong></div>
        <div><span>GLB size</span><strong data-gr="glb-size">—</strong></div>
      </div>
      <button type="button" class="game-ready-button" data-gr-action="analyze"><i data-lucide="scan-search"></i><span>Analyze</span></button>
    </div>
    <div class="game-ready-card">
      <div class="game-ready-title"><i data-lucide="triangle-alert"></i><span>Checks</span></div>
      <div class="game-ready-issues" data-gr="issues"><div class="game-ready-empty">Run Analyze</div></div>
    </div>
    <div class="game-ready-card">
      <div class="game-ready-title"><i data-lucide="sparkles"></i><span>Optimize</span></div>
      <div class="game-ready-note">Merge compatible vertices, recalculate normals и переиспользовать эквивалентные материалы.</div>
      <button type="button" class="game-ready-button" data-gr-action="optimize"><i data-lucide="wand-sparkles"></i><span>Optimize Scene</span></button>
    </div>
    <div class="game-ready-card">
      <div class="game-ready-title"><i data-lucide="layers-3"></i><span>LOD</span></div>
      <div class="game-ready-note">Создаёт LOD1 ≈50% и LOD2 ≈25%. Сниженные уровни скрыты во viewport и сохраняют metadata.</div>
      <button type="button" class="game-ready-button" data-gr-action="lod"><i data-lucide="layers"></i><span>Generate LOD 0/1/2</span></button>
    </div>`;
  content.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .game-ready-card{border-top:1px solid #444;padding:8px 0}.game-ready-card:first-child{border-top:0;padding-top:0}.game-ready-title{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:8px}.game-ready-metrics{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px}.game-ready-metrics div{display:flex;justify-content:space-between;gap:8px;background:#222;padding:5px 6px;border-radius:3px}.game-ready-metrics span{color:#aaa}.game-ready-metrics strong{font-weight:600;color:#eee}.game-ready-button{width:100%;min-height:29px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #454545;border-radius:3px;background:#303030;color:#ddd;margin-top:6px}.game-ready-button:hover{background:#454545}.game-ready-note{color:#999;font-size:11px;line-height:1.35}.game-ready-issues{display:grid;gap:4px}.game-ready-issue{padding:5px 6px;border-radius:3px;background:#252525;border-left:3px solid #777}.game-ready-issue.warning{border-left-color:#d69a32}.game-ready-issue.error{border-left-color:#d95b5b}.game-ready-issue strong{display:block;font-size:11px;margin-bottom:2px}.game-ready-issue span{color:#aaa;font-size:11px}.game-ready-empty{color:#888;padding:4px}`;
  document.head.appendChild(style);

  function hideOtherPanels() {
    for (const node of content.children) node.hidden = node !== panel;
    document.querySelectorAll('.property-tab').forEach((button) => button.classList.toggle('active', button === tab));
  }

  async function analyze() {
    const data = controller.analyze();
    panel.querySelector('[data-gr="meshes"]').textContent = data.meshes.toLocaleString();
    panel.querySelector('[data-gr="vertices"]').textContent = data.vertices.toLocaleString();
    panel.querySelector('[data-gr="triangles"]').textContent = data.triangles.toLocaleString();
    panel.querySelector('[data-gr="materials"]').textContent = data.materialCount.toLocaleString();
    panel.querySelector('[data-gr="textures"]').textContent = data.textureCount.toLocaleString();
    panel.querySelector('[data-gr="texture-mb"]').textContent = `${data.textureMB.toFixed(1)} MB`;
    const issues = panel.querySelector('[data-gr="issues"]');
    issues.replaceChildren();
    if (!data.issues.length) {
      const ok = document.createElement('div');
      ok.className = 'game-ready-empty';
      ok.textContent = '✓ Базовые проверки пройдены';
      issues.appendChild(ok);
    } else {
      data.issues.forEach((issue) => {
        const row = document.createElement('div');
        row.className = `game-ready-issue ${issue.level}`;
        const title = document.createElement('strong');
        title.textContent = issue.object || 'Scene';
        const message = document.createElement('span');
        message.textContent = issue.message;
        row.append(title, message);
        issues.appendChild(row);
      });
    }
    panel.querySelector('[data-gr="glb-size"]').textContent = '…';
    try {
      panel.querySelector('[data-gr="glb-size"]').textContent = formatBytes(await controller.estimateGlbSize());
    } catch (error) {
      panel.querySelector('[data-gr="glb-size"]').textContent = 'error';
      console.warn('[gluestack] GLB estimate failed', error);
    }
  }

  tab.addEventListener('click', () => {
    hideOtherPanels();
    panel.hidden = false;
    analyze();
  });

  document.querySelectorAll('[data-property-tab]').forEach((button) => {
    button.addEventListener('click', () => { panel.hidden = true; });
  });

  panel.querySelector('[data-gr-action="analyze"]').addEventListener('click', analyze);
  panel.querySelector('[data-gr-action="optimize"]').addEventListener('click', () => {
    if (controller.optimize()) analyze();
  });
  panel.querySelector('[data-gr-action="lod"]').addEventListener('click', () => {
    if (controller.generateLOD()) analyze();
  });

  refreshIcons();
  return { controller, panel, tab, analyze };
}
