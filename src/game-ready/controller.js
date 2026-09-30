import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : mesh.material ? [mesh.material] : [];
}

function textureSize(texture) {
  const image = texture?.image;
  const width = image?.width ?? image?.videoWidth ?? 0;
  const height = image?.height ?? image?.videoHeight ?? 0;
  return { width, height, bytes: width * height * 4 };
}

function materialKey(material) {
  if (!material) return 'null';
  return JSON.stringify({
    type: material.type,
    color: material.color?.getHexString?.(),
    emissive: material.emissive?.getHexString?.(),
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    transparent: material.transparent,
    side: material.side,
    maps: TEXTURE_SLOTS.map((slot) => material[slot]?.uuid ?? null),
  });
}

export class GameReadyController {
  constructor(editor, onStatus = null) {
    this.editor = editor;
    this.status = onStatus ?? ((message) => editor.events.onStatus(message));
    this.simplify = new SimplifyModifier();
  }

  analyze() {
    const result = {
      meshes: 0,
      vertices: 0,
      triangles: 0,
      materials: new Set(),
      textures: new Set(),
      textureBytes: 0,
      issues: [],
    };

    this.editor.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      result.meshes += 1;
      const geometry = object.geometry;
      const position = geometry?.getAttribute('position');
      if (!position || position.count < 3) {
        result.issues.push({ level: 'error', object: object.name, message: 'Empty mesh / нет валидных вершин' });
        return;
      }
      result.vertices += position.count;
      result.triangles += Math.floor((geometry.index?.count ?? position.count) / 3);
      if (!geometry.getAttribute('normal')) result.issues.push({ level: 'warning', object: object.name, message: 'Missing normals' });
      if ([object.scale.x, object.scale.y, object.scale.z].some((value) => Math.abs(value - 1) > 1e-5)) {
        result.issues.push({ level: 'warning', object: object.name, message: `Scale not applied (${object.scale.x.toFixed(2)}, ${object.scale.y.toFixed(2)}, ${object.scale.z.toFixed(2)})` });
      }
      for (let i = 0; i < position.count; i += 1) {
        if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) {
          result.issues.push({ level: 'error', object: object.name, message: 'Geometry contains NaN/Infinity' });
          break;
        }
      }
      for (const material of materialsOf(object)) {
        result.materials.add(material.uuid);
        for (const slot of TEXTURE_SLOTS) {
          const texture = material[slot];
          if (!texture || result.textures.has(texture.uuid)) continue;
          result.textures.add(texture.uuid);
          const size = textureSize(texture);
          result.textureBytes += size.bytes;
          if (size.width > 4096 || size.height > 4096) {
            result.issues.push({ level: 'warning', object: object.name, message: `${slot}: ${size.width}×${size.height} texture > 4096` });
          }
        }
      }
    });

    result.materialCount = result.materials.size;
    result.textureCount = result.textures.size;
    result.textureMB = result.textureBytes / (1024 * 1024);
    return result;
  }

  async estimateGlbSize() {
    if (!this.editor.modelRoot.children.length) return 0;
    const data = await new Promise((resolve, reject) => {
      this.editor.exporter.parse(this.editor.modelRoot, resolve, reject, {
        binary: true,
        onlyVisible: false,
        trs: false,
        maxTextureSize: 4096,
      });
    });
    return data.byteLength;
  }

  optimize() {
    const meshes = [];
    this.editor.modelRoot.traverse((object) => { if (object.isMesh && !object.isSkinnedMesh) meshes.push(object); });
    if (!meshes.length) return false;
    this.editor.checkpoint('Game Ready optimize');

    for (const mesh of meshes) {
      const source = mesh.geometry;
      if (!source?.getAttribute('position')) continue;
      let geometry = source.clone();
      try { geometry = mergeVertices(geometry, 1e-5); } catch {}
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      else {
        geometry.computeVertexNormals();
        geometry.normalizeNormals();
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      source.dispose();
      mesh.geometry = geometry;
    }

    const canonical = new Map();
    this.editor.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => {
          const key = materialKey(material);
          if (canonical.has(key)) return canonical.get(key);
          canonical.set(key, material);
          return material;
        });
      } else if (object.material) {
        const key = materialKey(object.material);
        if (canonical.has(key)) object.material = canonical.get(key);
        else canonical.set(key, object.material);
      }
    });
    this.editor.refreshSelectionVisuals();
    this.editor.events.onStructure();
    this.editor.events.onTransform(this.editor.selected);
    this.status(`Game Ready Optimize · ${meshes.length} mesh(es) · ${canonical.size} material(s)`);
    return true;
  }

  generateLOD(ratios = [0.5, 0.25]) {
    const source = this.editor.selected;
    if (!source?.isMesh || source.isSkinnedMesh || !source.geometry?.getAttribute('position')) {
      this.status('LOD: выберите обычный Mesh');
      return false;
    }
    const positionCount = source.geometry.getAttribute('position').count;
    if (positionCount < 12) {
      this.status('LOD: mesh слишком маленький для упрощения');
      return false;
    }

    this.editor.checkpoint('Generate LOD');
    const parent = source.parent ?? this.editor.modelRoot;
    const baseName = source.name.replace(/_LOD\d+$/i, '') || 'Mesh';
    source.name = `${baseName}_LOD0`;
    source.userData.gluestackLOD = { level: 0, ratio: 1, group: baseName };
    const generated = [source];

    ratios.forEach((ratio, index) => {
      const cleanRatio = THREE.MathUtils.clamp(Number(ratio), 0.05, 0.95);
      let geometry = source.geometry.clone();
      try {
        const count = geometry.getAttribute('position').count;
        const remove = Math.max(1, Math.floor(count * (1 - cleanRatio)));
        geometry = this.simplify.modify(geometry, remove);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      } catch (error) {
        console.warn('[gluestack] LOD simplify failed', error);
        return;
      }
      const lod = new THREE.Mesh(geometry, source.material);
      lod.name = `${baseName}_LOD${index + 1}`;
      lod.position.copy(source.position);
      lod.quaternion.copy(source.quaternion);
      lod.scale.copy(source.scale);
      lod.visible = false;
      lod.userData.gluestackLOD = { level: index + 1, ratio: cleanRatio, group: baseName };
      this.editor.assignIds(lod, true);
      parent.add(lod);
      generated.push(lod);
    });

    this.editor.select(source);
    this.editor.events.onStructure();
    this.status(`LOD создан: ${generated.map((mesh) => mesh.name).join(', ')}`);
    return true;
  }
}
