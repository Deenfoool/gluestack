import { refreshIcons } from '../ui.js';

function disposeParsedScene(root) {
  const textures = new Set();
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of materials) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
        if (material?.[key]?.isTexture) textures.add(material[key]);
      }
      material?.dispose?.();
    }
  });
  textures.forEach((texture) => texture.dispose());
}

async function externalSidecarFixture(importer) {
  if (!importer?.parseFiles) {
    return { name: 'external .gltf + .bin + texture', ok: false, detail: 'importer.parseFiles unavailable' };
  }

  const specs = [
    ['fixture.gltf', 'model/gltf+json'],
    ['mesh.bin', 'application/octet-stream'],
    ['albedo.png', 'image/png'],
  ];
  const files = [];
  try {
    for (const [name, type] of specs) {
      const url = new URL(`../../tests/fixtures/external/${name}`, import.meta.url);
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      files.push(new File([await response.blob()], name, { type }));
    }

    const parsed = await importer.parseFiles(files);
    let mesh = null;
    parsed.gltf.scene.traverse((object) => { if (!mesh && object.isMesh) mesh = object; });
    const material = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
    const position = mesh?.geometry?.getAttribute?.('position');
    const uv = mesh?.geometry?.getAttribute?.('uv');
    const ok = Boolean(mesh && position?.count === 3 && uv?.count === 3 && material?.map?.isTexture);
    const detail = ok
      ? `mesh ${position.count} vertices · UV ${uv.count} · external texture resolved`
      : 'sidecar parse completed but expected mesh/UV/texture was not preserved';
    disposeParsedScene(parsed.gltf.scene);
    return { name: 'external .gltf + .bin + texture', ok, detail };
  } catch (error) {
    return { name: 'external .gltf + .bin + texture', ok: false, detail: error.message || String(error) };
  }
}

async function projectV1Fixture(projects) {
  if (!projects?.decodeProject || !projects?.prepareGlbBuffer) {
    return { name: '.gluestack v1 → v2 migration', ok: false, detail: 'Project migration API unavailable' };
  }
  try {
    const url = new URL('../../tests/fixtures/project-v1.gluestack', import.meta.url);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const decoded = projects.decodeProject(await response.arrayBuffer());
    const prepared = await projects.prepareGlbBuffer(decoded.glb);
    const ok = decoded.metadata.version === 2
      && decoded.metadata.format === 'gluestack-project'
      && decoded.metadata.name === 'Golden v1 Project'
      && decoded.metadata.editor?.snapEnabled === true;
    disposeParsedScene(prepared.scene);
    return {
      name: '.gluestack v1 → v2 migration',
      ok,
      detail: ok ? 'v1 container decoded, migrated to v2 and GLB payload parsed' : `unexpected migrated metadata v${decoded.metadata.version ?? '?'}`,
    };
  } catch (error) {
    return { name: '.gluestack v1 → v2 migration', ok: false, detail: error.message || String(error) };
  }
}

export function installGoldenDiagnostics({ editor, diagnostics, importer, projects }) {
  if (!editor || !diagnostics || editor.__gluestackGoldenDiagnostics) return editor?.__gluestackGoldenDiagnostics ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.goldenFixtures = '';
  button.innerHTML = '<i data-lucide="flask-conical"></i><span>Run Golden Fixtures</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    editor.events.onStatus('Golden fixtures: running…');
    try {
      const { runGoldenFixtures } = await import('../../tests/fixtures/golden-fixtures.js');
      const results = await runGoldenFixtures(editor);
      results.push(await externalSidecarFixture(importer));
      results.push(await projectV1Fixture(projects));
      const failed = results.filter((item) => !item.ok);
      console.table(results.map((item) => ({ status: item.ok ? 'PASS' : 'FAIL', ...item })));
      editor.events.onStatus(failed.length ? `Golden fixtures: ${failed.length} FAIL` : `Golden fixtures: PASS · ${results.length}/${results.length}`);

      const overlay = diagnostics.overlay;
      const container = overlay?.querySelector('[data-diagnostics-results]');
      const summary = overlay?.querySelector('[data-diagnostics-summary]');
      if (overlay && container && summary) {
        overlay.hidden = false;
        summary.textContent = failed.length ? `Golden fixtures · ${failed.length} failed` : `Golden fixtures · ${results.length}/${results.length} passed`;
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
      return results;
    } catch (error) {
      console.error('[gluestack] golden fixtures failed', error);
      editor.events.onStatus(`Golden fixtures: ${error.message || error}`);
      return [{ name: 'fixture runner', ok: false, detail: error.message || String(error) }];
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run();
  });

  const api = { button, run };
  editor.__gluestackGoldenDiagnostics = api;
  window.__gluestackGoldenFixtures = api;
  refreshIcons();
  return api;
}
