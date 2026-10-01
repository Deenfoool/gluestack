import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { refreshIcons } from '../ui.js';

function result(name, ok, detail) {
  return { name, ok, detail, level: ok ? 'pass' : 'fail' };
}

function exportRoot(root) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => exporter.parse(root, resolve, reject, { binary: true, onlyVisible: false, trs: false, animations: [] }));
}

function parseGlb(buffer) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error)))));
}

function disposeRoot(root) {
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    const slots = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of slots) {
      materials.add(material);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
        if (material?.[key]?.isTexture) textures.add(material[key]);
      }
    }
  });
  materials.forEach((material) => material?.dispose?.());
  textures.forEach((texture) => texture?.dispose?.());
}

function triangleDataUri() {
  const values = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bytes = new Uint8Array(values.buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

async function cameraLightRoundTrip() {
  const root = new THREE.Group();
  root.name = 'CameraLightFixture';
  const camera = new THREE.PerspectiveCamera(48, 1.5, 0.1, 500);
  camera.name = 'FixtureCamera';
  camera.position.set(4, 3, 6);
  root.add(camera);
  const point = new THREE.PointLight(0xffffff, 2.5, 15, 2);
  point.name = 'FixturePoint';
  point.position.set(2, 3, 1);
  root.add(point);
  const directional = new THREE.DirectionalLight(0xffddbb, 1.2);
  directional.name = 'FixtureDirectional';
  directional.position.set(-3, 5, 2);
  root.add(directional);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  root.add(mesh);
  try {
    const parsed = await parseGlb(await exportRoot(root));
    let cameras = 0;
    let lights = 0;
    parsed.scene.traverse((object) => {
      if (object.isCamera) cameras += 1;
      if (object.isLight) lights += 1;
    });
    disposeRoot(parsed.scene);
    return result('Camera + punctual lights round-trip', cameras === 1 && lights === 2, `camera ${cameras}/1 · lights ${lights}/2`);
  } catch (error) {
    return result('Camera + punctual lights round-trip', false, error.message || String(error));
  } finally {
    disposeRoot(root);
  }
}

async function attributeRoundTrip() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  geometry.setAttribute('uv1', uv.clone());
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    colors[i * 3] = (i % 3) / 2;
    colors[i * 3 + 1] = ((i + 1) % 3) / 2;
    colors[i * 3 + 2] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  try { geometry.computeTangents(); } catch {}
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
  mesh.name = 'AttributeFixture';
  const root = new THREE.Group();
  root.add(mesh);
  try {
    const parsed = await parseGlb(await exportRoot(root));
    let loaded = null;
    parsed.scene.traverse((object) => { if (!loaded && object.isMesh) loaded = object; });
    const attrs = loaded?.geometry?.attributes ?? {};
    const ok = Boolean(attrs.position && attrs.normal && attrs.uv && attrs.uv1 && attrs.color && attrs.tangent);
    const detail = `uv ${Boolean(attrs.uv)} · uv1 ${Boolean(attrs.uv1)} · color ${Boolean(attrs.color)} · tangent ${Boolean(attrs.tangent)}`;
    disposeRoot(parsed.scene);
    return result('UV1 / color / tangent round-trip', ok, detail);
  } catch (error) {
    return result('UV1 / color / tangent round-trip', false, error.message || String(error));
  } finally {
    disposeRoot(root);
  }
}

async function dataUriFixture(importer) {
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 36, uri: triangleDataUri() }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', max: [1, 1, 0], min: [0, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  try {
    const parsed = await importer.parseFiles([new File([JSON.stringify(json)], 'data-uri.gltf', { type: 'model/gltf+json' })]);
    let mesh = null;
    parsed.gltf.scene.traverse((object) => { if (!mesh && object.isMesh) mesh = object; });
    const count = mesh?.geometry?.getAttribute('position')?.count ?? 0;
    disposeRoot(parsed.gltf.scene);
    return result('Data URI .gltf', count === 3, `position vertices ${count}/3`);
  } catch (error) {
    return result('Data URI .gltf', false, error.message || String(error));
  }
}

async function multipleScenesFixture(importer) {
  const json = {
    asset: { version: '2.0' },
    nodes: [{ name: 'SceneA' }, { name: 'SceneB' }],
    scenes: [{ name: 'First', nodes: [0] }, { name: 'Second', nodes: [1] }],
    scene: 1,
  };
  try {
    const parsed = await importer.parseFiles([new File([JSON.stringify(json)], 'multi-scenes.gltf', { type: 'model/gltf+json' })]);
    const scenes = parsed.gltf.scenes?.length ?? 0;
    const defaultName = parsed.gltf.scene?.name ?? '';
    disposeRoot(parsed.gltf.scene);
    return result('Multiple scenes default policy', scenes === 2 && defaultName === 'Second', `scenes ${scenes}/2 · default ${defaultName || 'unnamed'}`);
  } catch (error) {
    return result('Multiple scenes default policy', false, error.message || String(error));
  }
}

async function duplicateSidecarFixture(importer) {
  const json = {
    asset: { version: '2.0' },
    images: [{ uri: 'texture.png' }],
    scenes: [{}],
    scene: 0,
  };
  const primary = new File([JSON.stringify(json)], 'duplicate-sidecar.gltf', { type: 'model/gltf+json' });
  const a = new File([new Uint8Array([1, 2, 3])], 'texture.png', { type: 'image/png' });
  const b = new File([new Uint8Array([4, 5, 6])], 'texture.png', { type: 'image/png' });
  try {
    await importer.parseFiles([primary, a, b]);
    return result('Duplicate sidecar ambiguity rejection', false, 'ambiguous basename was accepted');
  } catch (error) {
    const ok = /Неоднозначные sidecar-файлы/.test(error.message || String(error));
    return result('Duplicate sidecar ambiguity rejection', ok, error.message || String(error));
  }
}

function decoderPolicyFixture(importer) {
  const policy = importer.extensionPolicy?.({ extensionsRequired: ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'] });
  const ok = policy?.blocked?.length === 3;
  return result('Required decoder extension policy', ok, `blocked ${policy?.blocked?.length ?? 0}/3`);
}

export function installImportExportDiagnostics({ editor, diagnostics, importer }) {
  if (!editor || !diagnostics || !importer || editor.__gluestackImportExportDiagnostics) return editor?.__gluestackImportExportDiagnostics ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<i data-lucide="file-check-2"></i><span>Test Import / Export</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    editor.events.onStatus('Import / Export Diagnostics: running…');
    try {
      const results = [
        await cameraLightRoundTrip(),
        await attributeRoundTrip(),
        await dataUriFixture(importer),
        await multipleScenesFixture(importer),
        await duplicateSidecarFixture(importer),
        decoderPolicyFixture(importer),
      ];
      const failed = results.filter((item) => !item.ok);
      const overlay = diagnostics.overlay;
      const container = overlay?.querySelector('[data-diagnostics-results]');
      const summary = overlay?.querySelector('[data-diagnostics-summary]');
      if (overlay && container && summary) {
        overlay.hidden = false;
        summary.textContent = failed.length ? `Import / Export · ${failed.length} failed` : `Import / Export · ${results.length}/${results.length} passed`;
        container.replaceChildren();
        for (const item of results) {
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
      console.table(results.map((item) => ({ status: item.ok ? 'PASS' : 'FAIL', ...item })));
      editor.events.onStatus(failed.length ? `Import / Export Diagnostics: ${failed.length} FAIL` : 'Import / Export Diagnostics: PASS');
      return results;
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run().catch((error) => {
      console.error('[gluestack] import/export diagnostics failed', error);
      editor.events.onStatus(`Import / Export Diagnostics: ${error.message || error}`);
    });
  });
  const api = { button, run };
  editor.__gluestackImportExportDiagnostics = api;
  refreshIcons();
  return api;
}
