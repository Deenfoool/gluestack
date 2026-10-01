import * as THREE from 'three';
import {
  CURRENT_PROJECT_VERSION,
  PROJECT_FORMAT,
  decodeProjectContainer,
  encodeProjectContainer,
} from '../../src/projects/format.js';

function material(color = 0xb8b8b8) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
}

function canvasTexture(hex, { srgb = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 4, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function rootWith(object, name) {
  const root = new THREE.Group();
  root.name = name;
  root.add(object);
  return root;
}

function findMesh(root, predicate = () => true) {
  let match = null;
  root.traverse((object) => {
    if (!match && object.isMesh && predicate(object)) match = object;
  });
  return match;
}

function countMaterialSlots(root) {
  let count = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    count += Array.isArray(object.material) ? object.material.length : object.material ? 1 : 0;
  });
  return count;
}

function disposeRoot(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const mat of objectMaterials) {
      materials.add(mat);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
        if (mat?.[key]?.isTexture) textures.add(mat[key]);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((mat) => mat.dispose?.());
  textures.forEach((texture) => texture.dispose?.());
}

function primitiveFixture() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material());
  mesh.name = 'GoldenPrimitive';
  return { name: 'primitive single-material', root: rootWith(mesh, 'FixturePrimitive'), assert: (gltf) => Boolean(findMesh(gltf.scene)) };
}

function multiMaterialFixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.clearGroups();
  const indexCount = geometry.index?.count ?? geometry.getAttribute('position').count;
  const half = Math.floor(indexCount / 6) * 3;
  geometry.addGroup(0, half, 0);
  geometry.addGroup(half, indexCount - half, 1);
  const mesh = new THREE.Mesh(geometry, [material(0xe06060), material(0x6080e0)]);
  mesh.name = 'GoldenMultiMaterial';
  return { name: 'multi-material groups', root: rootWith(mesh, 'FixtureMultiMaterial'), assert: (gltf) => countMaterialSlots(gltf.scene) >= 2 };
}

function uvFixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const mesh = new THREE.Mesh(geometry, material());
  mesh.name = 'GoldenUVIslands';
  return {
    name: 'UV islands',
    root: rootWith(mesh, 'FixtureUV'),
    assert: (gltf) => {
      const loaded = findMesh(gltf.scene);
      const position = loaded?.geometry?.getAttribute('position');
      const uv = loaded?.geometry?.getAttribute('uv');
      return Boolean(position && uv && position.count === uv.count);
    },
  };
}

function textureFixture() {
  const mat = material(0xffffff);
  mat.map = canvasTexture('#dd8844', { srgb: true });
  mat.normalMap = canvasTexture('#8080ff');
  mat.roughnessMap = canvasTexture('#999999');
  mat.metalnessMap = canvasTexture('#333333');
  mat.emissiveMap = canvasTexture('#221100', { srgb: true });
  mat.emissive.setHex(0xffffff);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = 'GoldenPBRTextures';
  return {
    name: 'PBR texture channels',
    root: rootWith(mesh, 'FixtureTextures'),
    assert: (gltf) => {
      const loaded = findMesh(gltf.scene);
      const loadedMaterial = Array.isArray(loaded?.material) ? loaded.material[0] : loaded?.material;
      return Boolean(loadedMaterial?.map && loadedMaterial?.normalMap && loadedMaterial?.roughnessMap && loadedMaterial?.metalnessMap && loadedMaterial?.emissiveMap);
    },
  };
}

function animationFixture() {
  const pivot = new THREE.Group();
  pivot.name = 'GoldenAnimatedNode';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), material(0x7cc576));
  mesh.name = 'GoldenAnimatedMesh';
  pivot.add(mesh);
  const clip = new THREE.AnimationClip('GoldenMove', 1, [
    new THREE.VectorKeyframeTrack('GoldenAnimatedNode.position', [0, 1], [0, 0, 0, 1, 0, 0]),
  ]);
  return {
    name: 'animated transform hierarchy',
    root: rootWith(pivot, 'FixtureAnimation'),
    animations: [clip],
    assert: (gltf) => gltf.animations?.length === 1 && gltf.animations[0].tracks.length === 1,
  };
}

function skinnedFixture() {
  const geometry = new THREE.BoxGeometry(1, 2, 1).toNonIndexed();
  const count = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) skinWeight[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const rootBone = new THREE.Bone();
  rootBone.name = 'GoldenRootBone';
  const childBone = new THREE.Bone();
  childBone.name = 'GoldenChildBone';
  childBone.position.y = 1;
  rootBone.add(childBone);
  const skeleton = new THREE.Skeleton([rootBone, childBone]);
  const mesh = new THREE.SkinnedMesh(geometry, material(0xc6a45d));
  mesh.name = 'GoldenSkinnedMesh';
  mesh.add(rootBone);
  mesh.bind(skeleton);
  return { name: 'skinned mesh', root: rootWith(mesh, 'FixtureSkin'), assert: (gltf) => Boolean(findMesh(gltf.scene, (object) => object.isSkinnedMesh)) };
}

function morphFixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const position = geometry.getAttribute('position');
  const morph = new Float32Array(position.array.length);
  for (let i = 0; i < position.count; i += 1) {
    morph[i * 3] = position.getX(i);
    morph[i * 3 + 1] = position.getY(i) + (position.getY(i) > 0 ? 0.25 : 0);
    morph[i * 3 + 2] = position.getZ(i);
  }
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(morph, 3)];
  const mesh = new THREE.Mesh(geometry, material(0xb273d1));
  mesh.name = 'GoldenMorphMesh';
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences[0] = 0.5;
  return { name: 'morph targets', root: rootWith(mesh, 'FixtureMorph'), assert: (gltf) => Boolean(findMesh(gltf.scene, (object) => object.geometry?.morphAttributes?.position?.length)) };
}

function customAttributeFixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) values[i] = i / Math.max(1, count - 1);
  geometry.setAttribute('_GOLDEN', new THREE.Float32BufferAttribute(values, 1));
  const mesh = new THREE.Mesh(geometry, material(0x63b7b3));
  mesh.name = 'GoldenCustomAttribute';
  return { name: 'custom BufferAttribute', root: rootWith(mesh, 'FixtureCustomAttribute'), assert: (gltf) => Boolean(findMesh(gltf.scene)?.geometry?.getAttribute('_GOLDEN')) };
}

function highPolyFixture() {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material(0x888888));
  mesh.name = 'GoldenHighPoly';
  return { name: 'high-poly mesh', root: rootWith(mesh, 'FixtureHighPoly'), assert: (gltf) => (findMesh(gltf.scene)?.geometry?.getAttribute('position')?.count ?? 0) > 4000 };
}

async function exportFixture(editor, fixture) {
  return new Promise((resolve, reject) => {
    editor.exporter.parse(fixture.root, resolve, reject, {
      binary: true,
      onlyVisible: false,
      trs: false,
      maxTextureSize: 64,
      animations: fixture.animations ?? [],
    });
  });
}

async function parseFixture(editor, buffer) {
  return new Promise((resolve, reject) => {
    editor.loader.parse(buffer, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

function projectMetadata(fixture) {
  return {
    format: PROJECT_FORMAT,
    version: CURRENT_PROJECT_VERSION,
    name: `Golden ${fixture.name}`,
    savedAt: '2026-01-01T00:00:00.000Z',
    camera: { position: [3, 3, 3], quaternion: [0, 0, 0, 1], target: [0, 0, 0], fov: 45 },
    selection: { ids: [], activeId: null },
    editor: { snapEnabled: false },
    viewport: {},
    integrity: { fixture: fixture.name },
  };
}

export async function runGoldenFixtures(editor) {
  const factories = [primitiveFixture, multiMaterialFixture, uvFixture, textureFixture, animationFixture, skinnedFixture, morphFixture, customAttributeFixture, highPolyFixture];
  const results = [];

  for (const factory of factories) {
    const fixture = factory();
    let gltf = null;
    let projectGltf = null;
    try {
      const buffer = await exportFixture(editor, fixture);
      gltf = await parseFixture(editor, buffer);
      const glbOk = Boolean(fixture.assert(gltf));

      const projectBuffer = encodeProjectContainer(projectMetadata(fixture), buffer);
      const decoded = decodeProjectContainer(projectBuffer);
      projectGltf = await parseFixture(editor, decoded.glb);
      const projectOk = decoded.metadata.version === CURRENT_PROJECT_VERSION
        && decoded.metadata.integrity?.fixture === fixture.name
        && Boolean(fixture.assert(projectGltf));

      results.push({
        name: fixture.name,
        ok: glbOk && projectOk,
        detail: `${buffer.byteLength.toLocaleString()} GLB bytes · ${projectBuffer.byteLength.toLocaleString()} project bytes · project ${projectOk ? 'PASS' : 'FAIL'}`,
      });
    } catch (error) {
      results.push({ name: fixture.name, ok: false, detail: error.message || String(error) });
    } finally {
      disposeRoot(gltf?.scene);
      disposeRoot(projectGltf?.scene);
      disposeRoot(fixture.root);
    }
  }

  let malformedRejected = false;
  try {
    await new Promise((resolve, reject) => {
      editor.loader.parse('this is not glTF json', '', resolve, () => reject(new Error('rejected')));
    });
  } catch {
    malformedRejected = true;
  }
  results.push({ name: 'malformed GLTF negative test', ok: malformedRejected, detail: malformedRejected ? 'invalid input rejected' : 'invalid input accepted unexpectedly' });
  return results;
}
