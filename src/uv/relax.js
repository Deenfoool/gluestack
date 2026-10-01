import * as THREE from 'three';

const EPS = 1e-7;
const POSITION_EPS = 1e-5;

function positionKey(v) {
  return `${Math.round(v.x / POSITION_EPS)}:${Math.round(v.y / POSITION_EPS)}:${Math.round(v.z / POSITION_EPS)}`;
}

function selectedIslandIds(controller) {
  if (!controller.selected?.size) return new Set();
  if (controller.mode === 'island') return new Set([...controller.selected].map(Number));
  const ids = new Set();
  for (const corner of controller.selectedCornerIds()) {
    const islandId = controller.cornerToIsland[corner];
    if (islandId >= 0) ids.add(islandId);
  }
  return ids;
}

function targetIslands(controller, selectedOnly) {
  if (!selectedOnly) return controller.islands;
  const selected = selectedIslandIds(controller);
  return controller.islands.filter((island) => selected.has(island.id));
}

function triangleArea2D(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
}

function triangleArea3D(a, b, c) {
  return new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(c, a),
  ).length() * 0.5;
}

function logicalIsland(controller, island) {
  const groups = new Map();
  const triangleLogical = new Map();
  for (const triangleId of island.triangles) {
    const triangle = controller.triangles[triangleId];
    const logical = triangle.corners.map((corner, index) => {
      const key = positionKey(triangle.positions[index]);
      if (!groups.has(key)) groups.set(key, { key, corners: new Set(), neighbors: new Set(), boundary: false });
      groups.get(key).corners.add(corner);
      return key;
    });
    triangleLogical.set(triangleId, logical);
  }

  const edgeCounts = new Map();
  for (const logical of triangleLogical.values()) {
    for (let i = 0; i < 3; i += 1) {
      const a = logical[i];
      const b = logical[(i + 1) % 3];
      groups.get(a).neighbors.add(b);
      groups.get(b).neighbors.add(a);
      const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
    }
  }
  for (const [key, count] of edgeCounts) {
    if (count !== 1) continue;
    const [a, b] = key.split('|');
    groups.get(a).boundary = true;
    groups.get(b).boundary = true;
  }
  return groups;
}

function logicalUV(group, uv) {
  const value = new THREE.Vector2();
  for (const corner of group.corners) value.add(new THREE.Vector2(uv.getX(corner), uv.getY(corner)));
  return value.multiplyScalar(1 / Math.max(1, group.corners.size));
}

function applyLogicalUV(group, uv, value) {
  for (const corner of group.corners) uv.setXY(corner, value.x, value.y);
}

export function relaxUVIslands(controller, {
  iterations = 12,
  strength = 0.45,
  selectedOnly = true,
  record = true,
} = {}) {
  if (!controller?.mesh) return { changed: 0, islands: 0 };
  controller.rebuildTopology();
  const islands = targetIslands(controller, selectedOnly);
  if (!islands.length) return { changed: 0, islands: 0 };
  const uv = controller.mesh.geometry.getAttribute('uv');
  const count = Math.max(1, Math.min(100, Math.floor(Number(iterations) || 12)));
  const blend = THREE.MathUtils.clamp(Number(strength) || 0.45, 0.01, 1);
  if (record) controller.editor.checkpoint('Relax UV islands');

  let changed = 0;
  for (const island of islands) {
    const groups = logicalIsland(controller, island);
    if (groups.size < 4) continue;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const current = new Map();
      for (const group of groups.values()) current.set(group.key, logicalUV(group, uv));
      const next = new Map();
      for (const group of groups.values()) {
        const value = current.get(group.key);
        if (group.boundary || !group.neighbors.size) {
          next.set(group.key, value);
          continue;
        }
        const average = new THREE.Vector2();
        let valid = 0;
        for (const neighborKey of group.neighbors) {
          const neighbor = current.get(neighborKey);
          if (!neighbor) continue;
          average.add(neighbor);
          valid += 1;
        }
        if (!valid) next.set(group.key, value);
        else next.set(group.key, value.clone().lerp(average.multiplyScalar(1 / valid), blend));
      }
      for (const group of groups.values()) {
        const value = next.get(group.key);
        if (!group.boundary && value) {
          applyLogicalUV(group, uv, value);
          changed += 1;
        }
      }
    }
  }

  uv.needsUpdate = true;
  controller.rebuildTopology();
  controller.render();
  controller.status(changed ? `UV Relax · ${islands.length} island(s) · ${count} iterations` : 'UV Relax: нет внутренних вершин для relaxation');
  return { changed, islands: islands.length, iterations: count, strength: blend };
}

export function stretchMetrics(controller) {
  if (!controller?.mesh) return [];
  const metrics = [];
  for (const triangle of controller.triangles) {
    const area3 = triangleArea3D(...triangle.positions);
    const area2 = triangleArea2D(...triangle.uvs);
    const ratio = area3 > EPS && area2 > EPS ? area2 / area3 : 0;
    metrics.push({ triangleId: triangle.id, area3, area2, ratio, score: 0 });
  }
  const valid = metrics.filter((item) => item.ratio > EPS);
  if (!valid.length) return metrics;
  const logMean = valid.reduce((sum, item) => sum + Math.log(item.ratio), 0) / valid.length;
  for (const item of metrics) {
    item.score = item.ratio > EPS ? Math.min(1, Math.abs(Math.log(item.ratio) - logMean) / 2) : 1;
  }
  return metrics;
}

function drawStretchHeatmap(controller, metrics) {
  const ctx = controller.ctx;
  if (!ctx || !controller.mesh) return;
  ctx.save();
  for (const metric of metrics) {
    const triangle = controller.triangles[metric.triangleId];
    if (!triangle) continue;
    const points = triangle.uvs.map((uv) => controller.uvToScreen(uv));
    const score = THREE.MathUtils.clamp(metric.score, 0, 1);
    const hue = 120 * (1 - score);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.lineTo(points[2].x, points[2].y);
    ctx.closePath();
    ctx.fillStyle = `hsla(${hue}, 82%, 50%, 0.28)`;
    ctx.fill();
  }
  ctx.restore();
}

export function installUVRelax({ controller, workspace }) {
  if (!controller || !workspace || controller.__uvRelax) return controller?.__uvRelax ?? null;
  const islandsSection = [...workspace.querySelectorAll('.uv-tools-section')]
    .find((section) => section.querySelector('h3')?.textContent.trim() === 'Islands');
  if (!islandsSection) return null;

  const panel = document.createElement('div');
  panel.className = 'uv-relax-tools';
  panel.innerHTML = `
    <div class="uv-relax-grid">
      <label><span>Iterations</span><input type="number" min="1" max="100" step="1" value="12" data-uv-relax-iterations></label>
      <label><span>Strength</span><input type="number" min="0.01" max="1" step="0.05" value="0.45" data-uv-relax-strength></label>
    </div>
    <div class="uv-relax-actions">
      <button type="button" data-uv-relax="selected">Relax Selected</button>
      <button type="button" data-uv-relax="all">Relax All</button>
      <button type="button" data-uv-stretch-toggle aria-pressed="false">Stretch Heatmap</button>
    </div>
    <div class="uv-stretch-summary" data-uv-stretch-summary>Stretch overlay off</div>`;
  islandsSection.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .uv-relax-tools{display:grid;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid #3d3d3d}.uv-relax-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}.uv-relax-grid label{display:grid;grid-template-columns:1fr 68px;gap:4px;align-items:center;font-size:10px;color:#aaa}.uv-relax-grid input{height:24px;min-width:0;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.uv-relax-actions{display:grid;grid-template-columns:1fr 1fr 1.1fr;gap:4px}.uv-relax-actions button{min-height:25px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.uv-relax-actions button:hover,.uv-relax-actions button[aria-pressed="true"]{background:#4b4b4b}.uv-stretch-summary{font-size:10px;color:#999}`;
  document.head.appendChild(style);

  const iterationsInput = panel.querySelector('[data-uv-relax-iterations]');
  const strengthInput = panel.querySelector('[data-uv-relax-strength]');
  const heatmapButton = panel.querySelector('[data-uv-stretch-toggle]');
  const summary = panel.querySelector('[data-uv-stretch-summary]');
  let heatmapEnabled = false;
  let lastMetrics = [];

  const originalRender = controller.render.bind(controller);
  controller.render = (...args) => {
    const result = originalRender(...args);
    if (heatmapEnabled && controller.mesh) drawStretchHeatmap(controller, lastMetrics = stretchMetrics(controller));
    return result;
  };

  function run(selectedOnly) {
    const result = relaxUVIslands(controller, {
      iterations: Number(iterationsInput.value) || 12,
      strength: Number(strengthInput.value) || 0.45,
      selectedOnly,
    });
    if (heatmapEnabled) controller.render();
    return result;
  }

  function toggleHeatmap() {
    heatmapEnabled = !heatmapEnabled;
    heatmapButton.setAttribute('aria-pressed', String(heatmapEnabled));
    if (heatmapEnabled) {
      lastMetrics = stretchMetrics(controller);
      const max = lastMetrics.reduce((value, item) => Math.max(value, item.score), 0);
      const avg = lastMetrics.length ? lastMetrics.reduce((sum, item) => sum + item.score, 0) / lastMetrics.length : 0;
      summary.textContent = `Stretch score · avg ${avg.toFixed(3)} · max ${max.toFixed(3)}`;
    } else summary.textContent = 'Stretch overlay off';
    controller.render();
  }

  panel.querySelector('[data-uv-relax="selected"]').addEventListener('click', () => run(true));
  panel.querySelector('[data-uv-relax="all"]').addEventListener('click', () => run(false));
  heatmapButton.addEventListener('click', toggleHeatmap);

  const api = { run, metrics: () => stretchMetrics(controller), toggleHeatmap, panel };
  controller.__uvRelax = api;
  return api;
}
