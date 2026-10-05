import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

function descriptor(id, type, params = {}) {
  return { id, type, enabled: true, params, ui: { collapsed: false } };
}

function result(name, ok, detail) {
  return { name, ok, detail, level: ok ? 'pass' : 'fail' };
}

function disposeMesh(mesh) {
  mesh?.geometry?.dispose?.();
  const materials = Array.isArray(mesh?.material) ? mesh.material : mesh?.material ? [mesh.material] : [];
  materials.forEach((material) => material?.dispose?.());
}

export function installModifierStackDiagnostics({ editor, diagnostics, modifierStack }) {
  if (!editor || !diagnostics || !modifierStack || editor.__gluestackModifierStackDiagnostics) return editor?.__gluestackModifierStackDiagnostics ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<i data-lucide="layers-3"></i><span>Test Modifier Stack</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    const checks = [];
    const baseline = modifierStack.debugCacheStats();
    // Stack UI prunes caches of detached meshes. Keep diagnostic meshes in a
    // hidden live subtree until cleanup; never select them or enter history.
    const root = new THREE.Group();
    root.name = '__ModifierStackDiagnostics';
    root.visible = false;
    editor.modelRoot.add(root);
    let mesh = null;
    let clone = null;
    try {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
      mesh.name = '__ModifierStackDiagnostic';
      editor.assignIds(mesh, true);
      root.add(mesh);
      mesh.userData.gluestackModifierStack = [
        descriptor('diag-mirror', 'mirror', { axis: 'x' }),
        descriptor('diag-array', 'array', { count: 2, x: 2.5, y: 0, z: 0 }),
      ];
      modifierStack.setSourceGeometry(mesh, mesh.geometry, { clone: true });
      const firstBuild = modifierStack.rebuild(mesh, { silent: true });
      const firstStats = modifierStack.debugCacheStats();
      checks.push(result(
        'Stack source/cache created',
        Boolean(firstBuild && firstStats.sourceEntries === baseline.sourceEntries + 1 && firstStats.cacheEntries === baseline.cacheEntries + 1),
        `sources ${baseline.sourceEntries}→${firstStats.sourceEntries} · caches ${baseline.cacheEntries}→${firstStats.cacheEntries}`,
      ));

      const firstVertexCount = mesh.geometry.getAttribute('position')?.count ?? 0;
      const secondBuild = modifierStack.rebuild(mesh, { silent: true });
      const secondVertexCount = mesh.geometry.getAttribute('position')?.count ?? 0;
      checks.push(result(
        'Repeated rebuild stable',
        Boolean(secondBuild && firstVertexCount === secondVertexCount && firstVertexCount > 0),
        `position vertices ${firstVertexCount}→${secondVertexCount}`,
      ));

      clone = mesh.clone(false);
      clone.geometry = mesh.geometry.clone();
      clone.material = mesh.material.clone();
      clone.userData = structuredClone(mesh.userData);
      editor.assignIds(clone, true);
      root.add(clone);
      const clonedStacks = modifierStack.cloneStackState(mesh, clone);
      const sourceCount = modifierStack.sourceFor(mesh)?.getAttribute('position')?.count ?? 0;
      const cloneSourceCount = modifierStack.sourceFor(clone)?.getAttribute('position')?.count ?? 0;
      const cloneVertexCount = clone.geometry.getAttribute('position')?.count ?? 0;
      checks.push(result(
        'Duplicate keeps independent source geometry',
        Boolean(clonedStacks === 1 && sourceCount > 0 && cloneSourceCount === sourceCount && cloneVertexCount === firstVertexCount),
        `stacked ${clonedStacks} · source ${sourceCount}/${cloneSourceCount} · evaluated ${firstVertexCount}/${cloneVertexCount}`,
      ));

      const post = new THREE.Matrix4().makeScale(1.5, 0.75, 2).premultiply(new THREE.Matrix4().makeTranslation(1, 2, 3));
      modifierStack.setPostMatrix(clone, post);
      const postBuild = modifierStack.rebuild(clone, { silent: true });
      const stored = modifierStack.getPostMatrix(clone);
      checks.push(result(
        'Post-stack matrix survives rebuild',
        Boolean(postBuild && stored.elements.every((value, index) => Math.abs(value - post.elements[index]) < 1e-9)),
        'Apply Transform / Origin support uses a post-stack matrix instead of baking modifiers',
      ));
    } catch (error) {
      checks.push(result('Modifier Stack diagnostic execution', false, error.message || String(error)));
    } finally {
      if (mesh) modifierStack.releaseMesh(mesh);
      if (clone) modifierStack.releaseMesh(clone);
      editor.modelRoot.remove(root);
      modifierStack.pruneCaches();
      disposeMesh(mesh);
      disposeMesh(clone);
      const finalStats = modifierStack.debugCacheStats();
      checks.push(result(
        'Source/cache lifecycle cleanup',
        finalStats.sourceEntries === baseline.sourceEntries && finalStats.cacheEntries === baseline.cacheEntries,
        `sources ${baseline.sourceEntries}→${finalStats.sourceEntries} · caches ${baseline.cacheEntries}→${finalStats.cacheEntries}`,
      ));
      button.disabled = false;
    }

    const failed = checks.filter((item) => !item.ok);
    const overlay = diagnostics.overlay;
    const container = overlay?.querySelector('[data-diagnostics-results]');
    const summary = overlay?.querySelector('[data-diagnostics-summary]');
    if (overlay && container && summary) {
      overlay.hidden = false;
      summary.textContent = failed.length ? `Modifier Stack · ${failed.length} failed` : `Modifier Stack · ${checks.length}/${checks.length} passed`;
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
    editor.events.onStatus(failed.length ? `Modifier Stack Diagnostics: ${failed.length} FAIL` : 'Modifier Stack Diagnostics: PASS');
    return checks;
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run().catch((error) => {
      console.error('[gluestack] modifier stack diagnostics failed', error);
      editor.events.onStatus(`Modifier Stack Diagnostics: ${error.message || error}`);
    });
  });

  const api = { button, run };
  editor.__gluestackModifierStackDiagnostics = api;
  refreshIcons();
  return api;
}
