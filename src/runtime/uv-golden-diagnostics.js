import * as THREE from 'three';
import { applyAngleSeams } from '../uv/smart-islands.js';
import { harmonicUnwrap } from '../uv/unwrap-solver.js';
import { relaxUVIslands } from '../uv/relax.js';
import { refreshIcons } from '../ui.js';

const EPS = 1e-9;

function signedUVAreas(mesh) {
  const geometry = mesh.geometry;
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  if (!uv || !position || uv.count !== position.count) return [];
  const index = geometry.index;
  const total = index?.count ?? position.count;
  const corner = (i) => index ? index.getX(i) : i;
  const result = [];
  for (let i = 0; i + 2 < total; i += 3) {
    const a = corner(i); const b = corner(i + 1); const c = corner(i + 2);
    result.push((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a))
      - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a)));
  }
  return result;
}

function signFlips(before, after) {
  let flips = 0;
  const count = Math.min(before.length, after.length);
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(before[i]) <= EPS || Math.abs(after[i]) <= EPS) continue;
    if (Math.sign(before[i]) !== Math.sign(after[i])) flips += 1;
  }
  return flips;
}

function toFixtureMesh(geometry, name) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geometry.dispose();
  source.computeBoundingBox();
  source.computeBoundingSphere();
  return new THREE.Mesh(source, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }));
}

function makeHundredIslandMesh() {
  const positions = [];
  const uvs = [];
  for (let i = 0; i < 100; i += 1) {
    const x = (i % 10) * 2;
    const z = Math.floor(i / 10) * 2;
    positions.push(x, 0, z, x + 1, 0, z, x, 0, z + 1);
    uvs.push(0, 0, 1, 0, 0, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function snapshotController(controller) {
  return {
    mesh: controller.mesh,
    mode: controller.mode,
    selected: new Set(controller.selected),
    triangles: controller.triangles,
    islands: controller.islands,
    cornerToIsland: controller.cornerToIsland,
    seams: new Set(controller.seams),
    zoom: controller.zoom,
    pan: controller.pan.clone(),
    textureImage: controller.textureImage,
  };
}

function restoreController(controller, state) {
  controller.mesh = state.mesh;
  controller.mode = state.mode;
  controller.selected = state.selected;
  controller.triangles = state.triangles;
  controller.islands = state.islands;
  controller.cornerToIsland = state.cornerToIsland;
  controller.seams = state.seams;
  controller.zoom = state.zoom;
  controller.pan.copy(state.pan);
  controller.textureImage = state.textureImage;
  controller.render();
  controller.updateInfo?.();
}

async function runFixture(controller, advancedUV, spec) {
  const mesh = toFixtureMesh(spec.geometry(), spec.name);
  mesh.name = spec.name;
  try {
    if (!controller.open(mesh)) throw new Error('UVController refused fixture');
    const seams = applyAngleSeams(controller, spec.angle, { replace: true, record: false });
    const unwrap = harmonicUnwrap(controller, { iterations: 90, record: false, pack: false });
    const before = signedUVAreas(mesh);
    const relax = relaxUVIslands(controller, { iterations: 8, strength: 0.3, selectedOnly: false, record: false });
    const after = signedUVAreas(mesh);
    const flips = signFlips(before, after);
    const packed = advancedUV.pack(false, false);
    const analysis = advancedUV.analyze();
    const ok = Boolean(
      unwrap.solved > 0
      && packed
      && analysis
      && analysis.overlaps === 0
      && analysis.outOfBounds === 0
      && analysis.zeroArea === 0
      && flips === 0,
    );
    return {
      name: `UV ${spec.name}`,
      ok,
      detail: `seams ${seams.total ?? 0} · unwrap ${unwrap.solved}/${unwrap.islands} · relax ${relax.changed} · flips ${flips} · overlap ${analysis?.overlaps ?? '?'} · OOB ${analysis?.outOfBounds ?? '?'} · zero ${analysis?.zeroArea ?? '?'}`,
    };
  } catch (error) {
    return { name: `UV ${spec.name}`, ok: false, detail: error.message || String(error) };
  } finally {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

async function runPackingStress(controller, advancedUV) {
  const mesh = makeHundredIslandMesh();
  try {
    controller.open(mesh);
    controller.rebuildTopology();
    const before = advancedUV.analyze();
    const packed = advancedUV.pack(false, false);
    const after = advancedUV.analyze();
    const ok = Boolean(packed && controller.islands.length === 100 && after?.overlaps === 0 && after?.outOfBounds === 0 && after?.zeroArea === 0);
    return {
      name: 'UV pack 100 islands',
      ok,
      detail: `islands ${controller.islands.length} · overlap ${before?.overlaps ?? '?'}→${after?.overlaps ?? '?'} · OOB ${after?.outOfBounds ?? '?'} · zero ${after?.zeroArea ?? '?'}`,
    };
  } catch (error) {
    return { name: 'UV pack 100 islands', ok: false, detail: error.message || String(error) };
  } finally {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

export function installUVGoldenDiagnostics({ editor, diagnostics, uv, advancedUV }) {
  const controller = uv?.controller;
  if (!editor || !diagnostics || !controller || !advancedUV || editor.__gluestackUVGoldenDiagnostics) return editor?.__gluestackUVGoldenDiagnostics ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<i data-lucide="scan-line"></i><span>Run UV Golden Fixtures</span>';
  menu.appendChild(button);

  const specs = [
    { name: 'cube hard seams', angle: 35, geometry: () => new THREE.BoxGeometry(2, 2, 2) },
    { name: 'cylinder', angle: 40, geometry: () => new THREE.CylinderGeometry(1, 1, 2, 24, 2, false) },
    { name: 'sphere', angle: 18, geometry: () => new THREE.SphereGeometry(1, 24, 16) },
    { name: 'organic', angle: 35, geometry: () => new THREE.IcosahedronGeometry(1, 2) },
    { name: 'ring hole topology', angle: 80, geometry: () => new THREE.RingGeometry(0.45, 1, 32, 4) },
  ];

  async function run() {
    button.disabled = true;
    const state = snapshotController(controller);
    editor.events.onStatus('UV Golden Fixtures: running…');
    const results = [];
    try {
      for (const spec of specs) results.push(await runFixture(controller, advancedUV, spec));
      results.push(await runPackingStress(controller, advancedUV));
    } finally {
      restoreController(controller, state);
      button.disabled = false;
    }

    const failed = results.filter((item) => !item.ok);
    const overlay = diagnostics.overlay;
    const container = overlay?.querySelector('[data-diagnostics-results]');
    const summary = overlay?.querySelector('[data-diagnostics-summary]');
    if (overlay && container && summary) {
      overlay.hidden = false;
      summary.textContent = failed.length ? `UV Golden Fixtures · ${failed.length} failed` : `UV Golden Fixtures · ${results.length}/${results.length} passed`;
      container.replaceChildren();
      for (const item of results) {
        const row = document.createElement('div');
        row.className = `diagnostics-row ${item.ok ? 'pass' : 'fail'}`;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = item.ok ? 'PASS' : 'FAIL';
        const name = document.createElement('strong');
        name.textContent = item.name;
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = item.detail;
        row.append(badge, name, detail);
        container.appendChild(row);
      }
    }
    console.table(results.map((item) => ({ status: item.ok ? 'PASS' : 'FAIL', ...item })));
    editor.events.onStatus(failed.length ? `UV Golden Fixtures: ${failed.length} FAIL` : 'UV Golden Fixtures: PASS');
    return results;
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run().catch((error) => {
      console.error('[gluestack] UV golden fixtures failed', error);
      editor.events.onStatus(`UV Golden Fixtures: ${error.message || error}`);
    });
  });

  const api = { button, run };
  editor.__gluestackUVGoldenDiagnostics = api;
  refreshIcons();
  return api;
}
