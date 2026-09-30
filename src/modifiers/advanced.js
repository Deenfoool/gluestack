import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cloneTriangle, readMeshTopology } from '../edit/topology.js';

export function applyTriangulate(modifiers) {
  const mesh = modifiers.getMesh();
  if (!mesh) return false;
  const topology = readMeshTopology(mesh);
  modifiers.editor.checkpoint('Triangulate');
  const vertices = topology.vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
  const triangles = topology.triangles.map(cloneTriangle);
  return modifiers.commit(mesh, vertices, triangles, topology.attributeState, 'Triangulate / Normalize применён');
}

export async function applyDecimate(modifiers, ratio = 0.5) {
  const mesh = modifiers.getMesh();
  ratio = Number(ratio);
  if (!mesh || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    modifiers.onStatus('Decimate: ratio должен быть между 0 и 1');
    return false;
  }
  if (Array.isArray(mesh.material) && mesh.material.length > 1) {
    modifiers.onStatus('Decimate: multi-material Mesh пока не поддерживается');
    return false;
  }

  let geometry = mesh.geometry.clone();
  try {
    if (!geometry.index) {
      const indexed = mergeVertices(geometry, 1e-5);
      geometry.dispose();
      geometry = indexed;
    }
    const position = geometry.getAttribute('position');
    if (!position || position.count < 8) {
      modifiers.onStatus('Decimate: геометрия слишком маленькая');
      geometry.dispose();
      return false;
    }

    const removeCount = Math.max(1, Math.min(position.count - 4, Math.floor(position.count * (1 - ratio))));
    modifiers.onStatus(`Decimate · упрощение до ~${Math.round(ratio * 100)}%…`);
    const simplifier = new SimplifyModifier();
    const simplified = await simplifier.modify(geometry, removeCount);
    geometry.dispose();

    if (modifiers.editor.selected !== mesh || !mesh.parent) {
      simplified.dispose();
      modifiers.onStatus('Decimate отменён: активный объект изменился');
      return false;
    }

    modifiers.editor.checkpoint('Decimate');
    mesh.geometry.dispose();
    mesh.geometry = simplified;
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    else {
      mesh.geometry.computeVertexNormals();
      mesh.geometry.normalizeNormals();
    }
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    modifiers.editor.refreshSelectionVisuals();
    modifiers.editor.events.onTransform(mesh);
    modifiers.editor.events.onStructure();
    modifiers.onStatus(`Decimate применён · цель ~${Math.round(ratio * 100)}%`);
    return true;
  } catch (error) {
    geometry?.dispose?.();
    console.error(error);
    modifiers.onStatus(`Decimate не выполнен: ${error.message || error}`);
    return false;
  }
}
