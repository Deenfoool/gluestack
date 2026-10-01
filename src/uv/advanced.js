import * as THREE from 'three';
import { packUVIslands } from './packing.js';

const EPS = 1e-7;

function triangleArea2D(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
}

function triangleArea3D(a, b, c) {
  return new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(c, a),
  ).length() * 0.5;
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

function selectedIslands(controller, selectedOnly) {
  if (!selectedOnly) return controller.islands;
  const ids = selectedIslandIds(controller);
  return controller.islands.filter((island) => ids.has(island.id));
}

function samePoint(a, b) {
  return a.distanceToSquared(b) <= EPS * EPS;
}

function sharedPointCount(a, b) {
  let count = 0;
  for (const pointA of a) if (b.some((pointB) => samePoint(pointA, pointB))) count += 1;
  return count;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function strictSegmentIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS))
    && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS));
}

function strictPointInTriangle(p, a, b, c) {
  const area = orient(a, b, c);
  if (Math.abs(area) <= EPS) return false;
  const w1 = orient(p, b, c) / area;
  const w2 = orient(a, p, c) / area;
  const w3 = orient(a, b, p) / area;
  return w1 > EPS && w2 > EPS && w3 > EPS && w1 < 1 - EPS && w2 < 1 - EPS && w3 < 1 - EPS;
}

function triangleOverlap(a, b) {
  if (sharedPointCount(a, b) === 2) return false;
  const bounds = (points) => ({
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  });
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.maxX <= bb.minX + EPS || bb.maxX <= ba.minX + EPS || ba.maxY <= bb.minY + EPS || bb.maxY <= ba.minY + EPS) return false;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      if (strictSegmentIntersect(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3])) return true;
    }
  }
  return strictPointInTriangle(a[0], ...b) || strictPointInTriangle(b[0], ...a);
}

function analyzeOverlaps(controller) {
  const triangles = controller.triangles.map((triangle) => triangle.uvs.map((uv) => uv.clone()));
  const grid = new Map();
  const gridSize = 12;
  const candidatePairs = new Set();
  let truncated = false;

  triangles.forEach((points, index) => {
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const x0 = THREE.MathUtils.clamp(Math.floor(minX * gridSize), -gridSize, gridSize * 2);
    const x1 = THREE.MathUtils.clamp(Math.floor(maxX * gridSize), -gridSize, gridSize * 2);
    const y0 = THREE.MathUtils.clamp(Math.floor(minY * gridSize), -gridSize, gridSize * 2);
    const y1 = THREE.MathUtils.clamp(Math.floor(maxY * gridSize), -gridSize, gridSize * 2);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const key = `${x}:${y}`;
        const bucket = grid.get(key) ?? [];
        for (const other of bucket) {
          const pair = other < index ? `${other}|${index}` : `${index}|${other}`;
          candidatePairs.add(pair);
          if (candidatePairs.size > 60000) { truncated = true; break; }
        }
        bucket.push(index);
        grid.set(key, bucket);
        if (truncated) break;
      }
      if (truncated) break;
    }
  });

  let overlaps = 0;
  for (const pair of candidatePairs) {
    const [a, b] = pair.split('|').map(Number);
    if (triangleOverlap(triangles[a], triangles[b])) overlaps += 1;
  }
  return { overlaps, truncated, candidates: candidatePairs.size };
}

function analyzeUV(controller) {
  controller.rebuildTopology();
  let outOfBounds = 0;
  let zeroArea = 0;
  const uv = controller.mesh.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < -EPS || u > 1 + EPS || v < -EPS || v > 1 + EPS) outOfBounds += 1;
  }
  for (const triangle of controller.triangles) {
    if (triangleArea2D(...triangle.uvs) <= EPS) zeroArea += 1;
  }
  return { outOfBounds, zeroArea, ...analyzeOverlaps(controller) };
}

function measureTexelDensity(controller, islands, resolution) {
  if (!controller.mesh || !islands.length) return 0;
  controller.mesh.updateWorldMatrix(true, false);
  const matrix = controller.mesh.matrixWorld;
  let area3 = 0;
  let area2 = 0;
  const triangleIds = new Set(islands.flatMap((island) => island.triangles));
  for (const id of triangleIds) {
    const triangle = controller.triangles[id];
    const world = triangle.positions.map((position) => position.clone().applyMatrix4(matrix));
    area3 += triangleArea3D(...world);
    area2 += triangleArea2D(...triangle.uvs);
  }
  if (area3 <= EPS || area2 <= EPS) return 0;
  return Math.sqrt(area2 / area3) * resolution;
}

function scaleIslandSet(controller, islands, factor) {
  const uv = controller.mesh.geometry.getAttribute('uv');
  const corners = new Set();
  islands.forEach((island) => island.corners.forEach((corner) => corners.add(corner)));
  if (!corners.size) return false;
  const center = [...corners].reduce((sum, corner) => (
    sum.add(new THREE.Vector2(uv.getX(corner), uv.getY(corner)))
  ), new THREE.Vector2()).multiplyScalar(1 / corners.size);
  for (const corner of corners) {
    const point = new THREE.Vector2(uv.getX(corner), uv.getY(corner)).sub(center).multiplyScalar(factor).add(center);
    uv.setXY(corner, point.x, point.y);
  }
  uv.needsUpdate = true;
  return true;
}

function mirrorIslandSet(controller, islands, axis) {
  const uv = controller.mesh.geometry.getAttribute('uv');
  const corners = new Set();
  islands.forEach((island) => island.corners.forEach((corner) => corners.add(corner)));
  if (!corners.size) return false;
  const center = [...corners].reduce((sum, corner) => (
    sum.add(new THREE.Vector2(uv.getX(corner), uv.getY(corner)))
  ), new THREE.Vector2()).multiplyScalar(1 / corners.size);
  for (const corner of corners) {
    let x = uv.getX(corner);
    let y = uv.getY(corner);
    if (axis === 'x') x = center.x * 2 - x;
    else y = center.y * 2 - y;
    uv.setXY(corner, x, y);
  }
  uv.needsUpdate = true;
  return true;
}

export function installAdvancedUV({ controller, workspace, editor }) {
  if (!controller || !workspace || controller.__advancedUV) return controller?.__advancedUV ?? null;

  const islandsSection = [...workspace.querySelectorAll('.uv-tools-section')].find((section) => section.querySelector('h3')?.textContent.trim() === 'Islands');
  if (!islandsSection) return null;

  const controls = document.createElement('div');
  controls.className = 'uv-advanced-tools';
  controls.innerHTML = `
    <div class="uv-advanced-grid">
      <label><span>Texture</span><select data-uv-resolution><option>512</option><option selected>1024</option><option>2048</option><option>4096</option></select></label>
      <label><span>Padding px</span><input data-uv-padding type="number" min="0" max="128" step="1" value="8"></label>
      <label class="uv-check"><input data-uv-rotate type="checkbox" checked><span>Rotate 90°</span></label>
    </div>
    <div class="uv-advanced-buttons">
      <button type="button" data-uv-advanced="pack-selected">Pack Selected</button>
      <button type="button" data-uv-advanced="analyze">Analyze UV</button>
      <button type="button" data-uv-advanced="mirror-x">Mirror X</button>
      <button type="button" data-uv-advanced="mirror-y">Mirror Y</button>
    </div>
    <div class="uv-density-row">
      <input data-uv-density type="number" min="0.001" step="1" placeholder="px / unit">
      <button type="button" data-uv-advanced="measure-density">Measure Density</button>
      <button type="button" data-uv-advanced="set-density">Set Density</button>
    </div>
    <div class="uv-analysis" data-uv-analysis>Advanced UV ready</div>`;
  islandsSection.appendChild(controls);

  const style = document.createElement('style');
  style.textContent = `
    .uv-advanced-tools{display:grid;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #3d3d3d}.uv-advanced-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.uv-advanced-grid label{display:grid;grid-template-columns:1fr 72px;align-items:center;gap:4px;font-size:10px;color:#aaa}.uv-advanced-grid input,.uv-advanced-grid select,.uv-density-row input{min-width:0;height:24px;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.uv-advanced-grid .uv-check{grid-column:1/-1;display:flex;justify-content:flex-start}.uv-advanced-buttons{display:grid;grid-template-columns:1fr 1fr;gap:4px}.uv-advanced-buttons button,.uv-density-row button{min-height:25px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.uv-advanced-buttons button:hover,.uv-density-row button:hover{background:#484848}.uv-density-row{display:grid;grid-template-columns:.8fr 1fr 1fr;gap:4px}.uv-analysis{font-size:10px;line-height:1.35;color:#999;background:#202020;border-radius:3px;padding:5px}`;
  document.head.appendChild(style);

  const resolutionInput = controls.querySelector('[data-uv-resolution]');
  const paddingInput = controls.querySelector('[data-uv-padding]');
  const rotateInput = controls.querySelector('[data-uv-rotate]');
  const densityInput = controls.querySelector('[data-uv-density]');
  const analysisOutput = controls.querySelector('[data-uv-analysis]');

  const settings = () => ({
    textureResolution: Math.max(1, Number(resolutionInput.value) || 1024),
    paddingPx: Math.max(0, Number(paddingInput.value) || 0),
    allowRotate: rotateInput.checked,
  });

  function pack(selectedOnly = false, record = true) {
    if (!controller.mesh) return false;
    controller.rebuildTopology();
    const islands = selectedIslands(controller, selectedOnly);
    if (!islands.length) {
      controller.status(selectedOnly ? 'Pack Selected: выберите UV island/edge/vertex' : 'Pack Islands: islands отсутствуют');
      return false;
    }
    if (record) editor.checkpoint(selectedOnly ? 'Pack selected UV islands' : 'Pack UV islands');
    try {
      const result = packUVIslands(islands, controller.mesh.geometry.getAttribute('uv'), settings());
      controller.rebuildTopology();
      controller.render();
      analysisOutput.textContent = `Packed ${result.count} · scale ${result.scale.toFixed(3)} · rotated ${result.rotated} · padding ${settings().paddingPx}px`;
      controller.status(`Pack Islands · ${result.count} · rotate ${result.rotated}`);
      return true;
    } catch (error) {
      controller.status(`Pack Islands: ${error.message || error}`);
      return false;
    }
  }

  const originalPack = controller.packIslands.bind(controller);
  controller.packIslands = (record = true) => pack(false, record) || originalPack(record);

  function analyze() {
    if (!controller.mesh) return null;
    const data = analyzeUV(controller);
    analysisOutput.textContent = `Overlap pairs ${data.overlaps}${data.truncated ? '+' : ''} · OOB corners ${data.outOfBounds} · zero-area ${data.zeroArea}`;
    controller.status(data.overlaps || data.outOfBounds || data.zeroArea ? 'UV Analyze: найдены проблемы' : 'UV Analyze: OK');
    return data;
  }

  function measureDensity(selectedOnly = true) {
    if (!controller.mesh) return 0;
    controller.rebuildTopology();
    let islands = selectedIslands(controller, selectedOnly);
    if (!islands.length) islands = controller.islands;
    const value = measureTexelDensity(controller, islands, settings().textureResolution);
    densityInput.value = value ? value.toFixed(2) : '';
    analysisOutput.textContent = value ? `Texel Density ${value.toFixed(2)} px/unit` : 'Texel Density unavailable';
    return value;
  }

  function setDensity() {
    if (!controller.mesh) return false;
    controller.rebuildTopology();
    let islands = selectedIslands(controller, true);
    if (!islands.length) islands = controller.islands;
    const current = measureTexelDensity(controller, islands, settings().textureResolution);
    const target = Number(densityInput.value);
    if (!current || !Number.isFinite(target) || target <= 0) {
      controller.status('Set Density: укажите корректный px/unit');
      return false;
    }
    editor.checkpoint('Set UV texel density');
    scaleIslandSet(controller, islands, target / current);
    controller.rebuildTopology();
    controller.render();
    controller.status(`Texel Density · ${target.toFixed(2)} px/unit`);
    return true;
  }

  function mirror(axis) {
    if (!controller.mesh) return false;
    controller.rebuildTopology();
    let islands = selectedIslands(controller, true);
    if (!islands.length) islands = controller.islands;
    editor.checkpoint(`UV Mirror ${axis.toUpperCase()}`);
    if (!mirrorIslandSet(controller, islands, axis)) return false;
    controller.rebuildTopology();
    controller.render();
    controller.status(`UV Mirror ${axis.toUpperCase()}`);
    return true;
  }

  controls.querySelectorAll('[data-uv-advanced]').forEach((button) => {
    button.addEventListener('click', () => {
      switch (button.dataset.uvAdvanced) {
        case 'pack-selected': pack(true); break;
        case 'analyze': analyze(); break;
        case 'measure-density': measureDensity(true); break;
        case 'set-density': setDensity(); break;
        case 'mirror-x': mirror('x'); break;
        case 'mirror-y': mirror('y'); break;
        default: break;
      }
    });
  });

  const api = { pack, analyze, measureDensity, setDensity, mirror };
  controller.__advancedUV = api;
  return api;
}
