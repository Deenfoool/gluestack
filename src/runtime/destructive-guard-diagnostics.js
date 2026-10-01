import * as THREE from 'three';
import { applyBoolean } from '../modifiers/boolean.js';
import { installDataIntegrity } from './data-integrity.js';
import { simplifyCompatibilityIssue } from './simplify-geometry.js';
import { refreshIcons } from '../ui.js';

function result(name, ok, detail) {
  return { name, ok, detail, level: ok ? 'pass' : 'fail' };
}

function morphMesh() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const position = geometry.getAttribute('position');
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(position.array.slice(), 3)];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'GuardMorph';
  mesh.updateMorphTargets();
  return mesh;
}

function customMesh() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('_GUARD', new THREE.Float32BufferAttribute(new Float32Array(count).fill(0.5), 1));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'GuardCustom';
  return mesh;
}

function plainMesh(name = 'GuardPlain') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

function disposeMesh(mesh) {
  mesh?.geometry?.dispose?.();
  const materials = Array.isArray(mesh?.material) ? mesh.material : mesh?.material ? [mesh.material] : [];
  materials.forEach((material) => material?.dispose?.());
}

function testDataIntegrityGuards() {
  const statuses = [];
  const morph = morphMesh();
  const custom = customMesh();
  let editCalls = 0;
  let joinCalls = 0;
  const editMode = { enter: () => { editCalls += 1; return true; } };
  const fakeEditor = {
    selected: morph,
    modifierStack: null,
    events: { onStatus: (message) => statuses.push(message) },
    joinSelected: () => { joinCalls += 1; return true; },
    getTopLevelSelection: () => [custom, plainMesh('JoinPeer')],
  };
  const peer = fakeEditor.getTopLevelSelection()[1];
  fakeEditor.getTopLevelSelection = () => [custom, peer];
  try {
    installDataIntegrity({ editor: fakeEditor, editMode });
    const editResult = editMode.enter(morph);
    const joinResult = fakeEditor.joinSelected();
    return result(
      'Edit/Join destructive guards',
      editResult === false && joinResult === false && editCalls === 0 && joinCalls === 0,
      `Edit blocked ${editResult === false} · Join blocked ${joinResult === false}`,
    );
  } finally {
    disposeMesh(morph);
    disposeMesh(custom);
    disposeMesh(peer);
  }
}

function testBooleanGuards() {
  const statuses = [];
  const morph = morphMesh();
  const custom = customMesh();
  const cutter = plainMesh('GuardCutter');
  const originalMorph = morph.geometry;
  const originalCustom = custom.geometry;
  const fakeEditor = {
    selected: morph,
    getSelectedObjects: () => [morph, cutter],
    checkpoint() { throw new Error('Boolean guard reached checkpoint unexpectedly'); },
    select() {},
    events: { onStructure() {}, onTransform() {} },
  };
  const modifiers = { editor: fakeEditor, onStatus: (message) => statuses.push(message) };
  try {
    const morphBlocked = applyBoolean(modifiers, 'difference') === false && morph.geometry === originalMorph;
    fakeEditor.selected = custom;
    fakeEditor.getSelectedObjects = () => [custom, cutter];
    const customBlocked = applyBoolean(modifiers, 'difference') === false && custom.geometry === originalCustom;
    return result(
      'Boolean destructive guards',
      morphBlocked && customBlocked,
      `morph ${morphBlocked ? 'blocked' : 'FAILED'} · custom attribute ${customBlocked ? 'blocked' : 'FAILED'}`,
    );
  } finally {
    disposeMesh(morph);
    disposeMesh(custom);
    disposeMesh(cutter);
  }
}

function testSimplifyGuards() {
  const morph = morphMesh();
  const custom = customMesh();
  try {
    const morphIssue = simplifyCompatibilityIssue(morph);
    const customIssue = simplifyCompatibilityIssue(custom);
    return result(
      'LOD/Decimate destructive guards',
      Boolean(morphIssue && customIssue),
      `morph: ${morphIssue || 'NOT BLOCKED'} · custom: ${customIssue || 'NOT BLOCKED'}`,
    );
  } finally {
    disposeMesh(morph);
    disposeMesh(custom);
  }
}

export function installDestructiveGuardDiagnostics({ editor, diagnostics }) {
  if (!editor || !diagnostics || editor.__gluestackDestructiveGuardDiagnostics) return editor?.__gluestackDestructiveGuardDiagnostics ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<i data-lucide="shield-check"></i><span>Test Data Guards</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    const checks = [];
    try {
      checks.push(testDataIntegrityGuards());
      checks.push(testBooleanGuards());
      checks.push(testSimplifyGuards());
    } catch (error) {
      checks.push(result('Data guard diagnostic execution', false, error.message || String(error)));
    } finally {
      button.disabled = false;
    }

    const failed = checks.filter((item) => !item.ok);
    const overlay = diagnostics.overlay;
    const container = overlay?.querySelector('[data-diagnostics-results]');
    const summary = overlay?.querySelector('[data-diagnostics-summary]');
    if (overlay && container && summary) {
      overlay.hidden = false;
      summary.textContent = failed.length ? `Data Guards · ${failed.length} failed` : `Data Guards · ${checks.length}/${checks.length} passed`;
      container.replaceChildren();
      for (const item of checks) {
        const row = document.createElement('div');
        row.className = `diagnostics-row ${item.level}`;
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
    console.table(checks.map((item) => ({ status: item.ok ? 'PASS' : 'FAIL', ...item })));
    editor.events.onStatus(failed.length ? `Data Guards: ${failed.length} FAIL` : 'Data Guards: PASS');
    return checks;
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run();
  });

  const api = { button, run };
  editor.__gluestackDestructiveGuardDiagnostics = api;
  refreshIcons();
  return api;
}
