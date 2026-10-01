import * as THREE from 'three';

const EPS = 1e-7;
const POSITION_EPS = 1e-5;

function positionKey(v) {
  return `${Math.round(v.x / POSITION_EPS)}:${Math.round(v.y / POSITION_EPS)}:${Math.round(v.z / POSITION_EPS)}`;
}

function geometricEdgeKey(a, b) {
  const ka = positionKey(a);
  const kb = positionKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function selectedIslandIds(controller) {
  if (!controller.selected?.size) return [];
  if (controller.mode === 'island') return [...controller.selected].map(Number).filter(Number.isInteger);
  const ids = new Set();
  for (const corner of controller.selectedCornerIds()) {
    const islandId = controller.cornerToIsland[corner];
    if (islandId >= 0) ids.add(islandId);
  }
  return [...ids];
}

function islandBounds(island, uv) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const corner of island.corners) {
    minX = Math.min(minX, uv.getX(corner));
    maxX = Math.max(maxX, uv.getX(corner));
    minY = Math.min(minY, uv.getY(corner));
    maxY = Math.max(maxY, uv.getY(corner));
  }
  return {
    minX, maxX, minY, maxY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    width: Math.max(EPS, maxX - minX),
    height: Math.max(EPS, maxY - minY),
  };
}

function translateIsland(island, uv, dx, dy) {
  for (const corner of island.corners) uv.setXY(corner, uv.getX(corner) + dx, uv.getY(corner) + dy);
}

function scaleIsland(island, uv, factor) {
  const bounds = islandBounds(island, uv);
  for (const corner of island.corners) {
    const x = bounds.centerX + (uv.getX(corner) - bounds.centerX) * factor;
    const y = bounds.centerY + (uv.getY(corner) - bounds.centerY) * factor;
    uv.setXY(corner, x, y);
  }
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

function islandDensity(controller, island, resolution) {
  controller.mesh.updateWorldMatrix(true, false);
  let area3 = 0;
  let area2 = 0;
  for (const triangleId of island.triangles) {
    const triangle = controller.triangles[triangleId];
    if (!triangle) continue;
    const world = triangle.positions.map((p) => p.clone().applyMatrix4(controller.mesh.matrixWorld));
    area3 += triangleArea3D(...world);
    area2 += triangleArea2D(...triangle.uvs);
  }
  return area3 > EPS && area2 > EPS ? Math.sqrt(area2 / area3) * resolution : 0;
}

export function alignSelectedIslands(controller, mode) {
  if (!controller?.mesh) return false;
  controller.rebuildTopology();
  const ids = selectedIslandIds(controller);
  const islands = ids.map((id) => controller.islands[id]).filter(Boolean);
  if (islands.length < 2) {
    controller.status('Align Islands: выберите минимум 2 UV islands');
    return false;
  }
  const uv = controller.mesh.geometry.getAttribute('uv');
  const bounds = islands.map((island) => islandBounds(island, uv));
  const selection = {
    minX: Math.min(...bounds.map((b) => b.minX)),
    maxX: Math.max(...bounds.map((b) => b.maxX)),
    minY: Math.min(...bounds.map((b) => b.minY)),
    maxY: Math.max(...bounds.map((b) => b.maxY)),
  };
  selection.centerX = (selection.minX + selection.maxX) * 0.5;
  selection.centerY = (selection.minY + selection.maxY) * 0.5;

  controller.editor.checkpoint(`Align UV islands ${mode}`);
  islands.forEach((island, index) => {
    const b = bounds[index];
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = selection.minX - b.minX;
    else if (mode === 'right') dx = selection.maxX - b.maxX;
    else if (mode === 'center-x') dx = selection.centerX - b.centerX;
    else if (mode === 'bottom') dy = selection.minY - b.minY;
    else if (mode === 'top') dy = selection.maxY - b.maxY;
    else if (mode === 'center-y') dy = selection.centerY - b.centerY;
    translateIsland(island, uv, dx, dy);
  });
  uv.needsUpdate = true;
  controller.rebuildTopology();
  controller.render();
  controller.status(`UV Align · ${mode}`);
  return true;
}

export function normalizeUVToUnit(controller, padding = 0.01) {
  if (!controller?.mesh || !controller.islands.length) return false;
  controller.rebuildTopology();
  const uv = controller.mesh.geometry.getAttribute('uv');
  const bounds = controller.islands.map((island) => islandBounds(island, uv));
  const minX = Math.min(...bounds.map((b) => b.minX));
  const maxX = Math.max(...bounds.map((b) => b.maxX));
  const minY = Math.min(...bounds.map((b) => b.minY));
  const maxY = Math.max(...bounds.map((b) => b.maxY));
  const width = Math.max(EPS, maxX - minX);
  const height = Math.max(EPS, maxY - minY);
  const safePadding = THREE.MathUtils.clamp(Number(padding) || 0, 0, 0.45);
  const available = 1 - safePadding * 2;
  const scale = available / Math.max(width, height);
  const offsetX = safePadding + (available - width * scale) * 0.5;
  const offsetY = safePadding + (available - height * scale) * 0.5;

  controller.editor.checkpoint('Normalize UV to 0..1');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, offsetX + (uv.getX(i) - minX) * scale, offsetY + (uv.getY(i) - minY) * scale);
  }
  uv.needsUpdate = true;
  controller.rebuildTopology();
  controller.render();
  controller.status(`UV Normalize 0..1 · uniform scale ${scale.toFixed(3)}`);
  return true;
}

export function matchSelectedTexelDensity(controller, resolution = 1024) {
  if (!controller?.mesh) return false;
  controller.rebuildTopology();
  const ids = selectedIslandIds(controller);
  const islands = ids.map((id) => controller.islands[id]).filter(Boolean);
  if (islands.length < 2) {
    controller.status('Match Density: выберите минимум 2 islands; первый выбранный задаёт density');
    return false;
  }
  const uv = controller.mesh.geometry.getAttribute('uv');
  const target = islandDensity(controller, islands[0], resolution);
  if (!target) {
    controller.status('Match Density: density первого island невалидна');
    return false;
  }
  controller.editor.checkpoint('Match UV texel density');
  let matched = 0;
  for (const island of islands.slice(1)) {
    const current = islandDensity(controller, island, resolution);
    if (!current) continue;
    scaleIsland(island, uv, target / current);
    matched += 1;
  }
  uv.needsUpdate = true;
  controller.rebuildTopology();
  controller.render();
  controller.status(`Match Density · ${matched} island(s) → ${target.toFixed(2)} px/unit`);
  return matched > 0;
}

export function stitchSelectedEdges(controller) {
  if (!controller?.mesh || controller.mode !== 'edge' || !controller.selected?.size) {
    controller?.status?.('Stitch UV: переключитесь в Edge Select и выделите совпадающие рёбра');
    return false;
  }
  controller.rebuildTopology();
  const uv = controller.mesh.geometry.getAttribute('uv');
  const position = controller.mesh.geometry.getAttribute('position');
  const groups = new Map();

  for (const selectedKey of controller.selected) {
    const [a, b] = String(selectedKey).split('|').map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    const pa = new THREE.Vector3().fromBufferAttribute(position, a);
    const pb = new THREE.Vector3().fromBufferAttribute(position, b);
    const key = geometricEdgeKey(pa, pb);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ a, b, pa, pb });
  }

  const stitchable = [...groups.entries()].filter(([, edges]) => edges.length >= 2);
  if (!stitchable.length) {
    controller.status('Stitch UV: среди выбранных рёбер нет двух UV-копий одного geometric edge');
    return false;
  }

  controller.editor.checkpoint('Stitch UV edges');
  let stitched = 0;
  for (const [key, edges] of stitchable) {
    const endpointGroups = new Map();
    for (const edge of edges) {
      for (const [corner, point] of [[edge.a, edge.pa], [edge.b, edge.pb]]) {
        const pkey = positionKey(point);
        if (!endpointGroups.has(pkey)) endpointGroups.set(pkey, []);
        endpointGroups.get(pkey).push(corner);
      }
    }
    if (endpointGroups.size !== 2) continue;
    for (const corners of endpointGroups.values()) {
      const average = corners.reduce((sum, corner) => (
        sum.add(new THREE.Vector2(uv.getX(corner), uv.getY(corner)))
      ), new THREE.Vector2()).multiplyScalar(1 / corners.length);
      for (const corner of corners) uv.setXY(corner, average.x, average.y);
    }
    controller.seams.delete(key);
    stitched += 1;
  }

  uv.needsUpdate = true;
  controller.saveSeams();
  controller.rebuildTopology();
  controller.render();
  controller.status(`Stitch UV · ${stitched} edge(s)`);
  return stitched > 0;
}

export function installUVIslandTools({ controller, workspace }) {
  if (!controller || !workspace || controller.__uvIslandTools) return controller?.__uvIslandTools ?? null;
  const islandsSection = [...workspace.querySelectorAll('.uv-tools-section')]
    .find((section) => section.querySelector('h3')?.textContent.trim() === 'Islands');
  if (!islandsSection) return null;

  const panel = document.createElement('div');
  panel.className = 'uv-island-extra-tools';
  panel.innerHTML = `
    <div class="uv-align-grid">
      <button data-uv-align="left">Left</button><button data-uv-align="center-x">Center X</button><button data-uv-align="right">Right</button>
      <button data-uv-align="bottom">Bottom</button><button data-uv-align="center-y">Center Y</button><button data-uv-align="top">Top</button>
    </div>
    <div class="uv-island-extra-actions">
      <button data-uv-island-extra="normalize">Normalize 0..1</button>
      <button data-uv-island-extra="match-density">Match Density</button>
      <button data-uv-island-extra="stitch">Stitch Selected Edges</button>
    </div>`;
  islandsSection.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .uv-island-extra-tools{display:grid;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid #3d3d3d}.uv-align-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}.uv-island-extra-actions{display:grid;grid-template-columns:1fr 1fr;gap:4px}.uv-island-extra-actions button:last-child{grid-column:1/-1}.uv-align-grid button,.uv-island-extra-actions button{min-height:24px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.uv-align-grid button:hover,.uv-island-extra-actions button:hover{background:#484848}`;
  document.head.appendChild(style);

  panel.querySelectorAll('[data-uv-align]').forEach((button) => {
    button.addEventListener('click', () => alignSelectedIslands(controller, button.dataset.uvAlign));
  });
  panel.querySelector('[data-uv-island-extra="normalize"]').addEventListener('click', () => normalizeUVToUnit(controller));
  panel.querySelector('[data-uv-island-extra="match-density"]').addEventListener('click', () => {
    const resolution = Number(workspace.querySelector('[data-uv-resolution]')?.value) || 1024;
    matchSelectedTexelDensity(controller, resolution);
  });
  panel.querySelector('[data-uv-island-extra="stitch"]').addEventListener('click', () => stitchSelectedEdges(controller));

  const api = {
    align: (mode) => alignSelectedIslands(controller, mode),
    normalize: (padding) => normalizeUVToUnit(controller, padding),
    matchDensity: (resolution) => matchSelectedTexelDensity(controller, resolution),
    stitch: () => stitchSelectedEdges(controller),
    panel,
  };
  controller.__uvIslandTools = api;
  return api;
}
