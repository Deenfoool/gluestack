import * as THREE from 'three';

const POSITION_EPS = 1e-5;

function positionKey(v) {
  return `${Math.round(v.x / POSITION_EPS)}:${Math.round(v.y / POSITION_EPS)}:${Math.round(v.z / POSITION_EPS)}`;
}

function geometricEdgeKey(a, b) {
  const ka = positionKey(a);
  const kb = positionKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function sharedEdges(controller) {
  const owners = new Map();
  for (const triangle of controller.triangles) {
    for (let edge = 0; edge < 3; edge += 1) {
      const key = geometricEdgeKey(triangle.positions[edge], triangle.positions[(edge + 1) % 3]);
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push({ triangleId: triangle.id, edge });
    }
  }
  return owners;
}

function angleDegrees(a, b) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(dot));
}

export function applyAngleSeams(controller, thresholdDegrees = 60, { replace = true, record = true } = {}) {
  if (!controller?.mesh) return { added: 0, kept: 0, boundary: 0 };
  controller.rebuildTopology();
  const threshold = THREE.MathUtils.clamp(Number(thresholdDegrees) || 60, 0, 180);
  if (record) controller.editor.checkpoint('Smart UV seams by angle');

  const next = replace ? new Set() : new Set(controller.seams);
  let added = 0;
  let boundary = 0;

  for (const [key, edgeOwners] of sharedEdges(controller)) {
    if (edgeOwners.length !== 2) {
      boundary += 1;
      continue;
    }
    const a = controller.triangles[edgeOwners[0].triangleId];
    const b = controller.triangles[edgeOwners[1].triangleId];
    if (!a || !b) continue;
    if (angleDegrees(a.normal, b.normal) + 1e-6 < threshold) continue;
    if (!next.has(key)) added += 1;
    next.add(key);
  }

  controller.seams = next;
  controller.saveSeams();
  controller.rebuildTopology();
  controller.render();
  controller.status(`Smart Seams · angle ${threshold.toFixed(1)}° · seams ${next.size}`);
  return { added, kept: next.size - added, boundary, total: next.size, threshold };
}

export function installSmartIslands({ controller, workspace }) {
  if (!controller || !workspace || controller.__smartIslands) return controller?.__smartIslands ?? null;

  const unwrapSection = [...workspace.querySelectorAll('.uv-tools-section')]
    .find((section) => section.querySelector('h3')?.textContent.trim() === 'Unwrap');
  if (!unwrapSection) return null;

  const panel = document.createElement('div');
  panel.className = 'uv-smart-islands';
  panel.innerHTML = `
    <label class="uv-smart-field"><span>Angle</span><input type="number" min="0" max="180" step="1" value="60" data-uv-smart-angle><span>°</span></label>
    <label class="uv-smart-check"><input type="checkbox" checked data-uv-smart-replace><span>Replace seams</span></label>
    <div class="uv-smart-actions">
      <button type="button" data-uv-smart-action="seams">Smart Seams</button>
      <button type="button" data-uv-smart-action="unwrap">Smart Seams + Unwrap</button>
    </div>`;
  unwrapSection.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .uv-smart-islands{display:grid;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid #3d3d3d}.uv-smart-field{display:grid;grid-template-columns:1fr 70px 14px;gap:4px;align-items:center;font-size:10px;color:#aaa}.uv-smart-field input{height:24px;min-width:0;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.uv-smart-check{display:flex;gap:5px;align-items:center;font-size:10px;color:#aaa}.uv-smart-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:4px}.uv-smart-actions button{min-height:25px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.uv-smart-actions button:hover{background:#484848}`;
  document.head.appendChild(style);

  const angleInput = panel.querySelector('[data-uv-smart-angle]');
  const replaceInput = panel.querySelector('[data-uv-smart-replace]');

  function run(unwrap = false) {
    if (!controller.mesh) {
      controller.status('Smart Islands: выберите Mesh');
      return false;
    }
    const threshold = Number(angleInput.value) || 60;
    controller.editor.checkpoint(unwrap ? 'Smart seams and unwrap' : 'Smart seams by angle');
    applyAngleSeams(controller, threshold, { replace: replaceInput.checked, record: false });
    if (unwrap) controller.unwrap();
    return true;
  }

  panel.querySelector('[data-uv-smart-action="seams"]').addEventListener('click', () => run(false));
  panel.querySelector('[data-uv-smart-action="unwrap"]').addEventListener('click', () => run(true));

  const api = {
    apply: (threshold, options = {}) => applyAngleSeams(controller, threshold, options),
    run,
    panel,
  };
  controller.__smartIslands = api;
  return api;
}
