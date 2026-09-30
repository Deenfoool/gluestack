import { cloneTriangle, readMeshTopology } from '../edit/topology.js';
import { disposeGeometryIfUnreferenced } from '../runtime/resource-ownership.js';
import {
  simplifyCompatibilityIssue,
  simplifyGeometryPreservingGroups,
} from '../runtime/simplify-geometry.js';

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

  const issue = simplifyCompatibilityIssue(mesh);
  if (issue) {
    modifiers.onStatus(`Decimate отменён: ${issue}`);
    return false;
  }

  try {
    const position = mesh.geometry.getAttribute('position');
    if (!position || position.count < 8) {
      modifiers.onStatus('Decimate: геометрия слишком маленькая');
      return false;
    }

    modifiers.onStatus(`Decimate · упрощение до ~${Math.round(ratio * 100)}%…`);
    const { geometry: simplified, groupCount } = simplifyGeometryPreservingGroups(mesh.geometry, ratio);

    if (modifiers.editor.selected !== mesh || !mesh.parent) {
      simplified.dispose();
      modifiers.onStatus('Decimate отменён: активный объект изменился');
      return false;
    }

    modifiers.editor.checkpoint('Decimate');
    const source = mesh.geometry;
    mesh.geometry = simplified;
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    else mesh.geometry.normalizeNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    disposeGeometryIfUnreferenced(modifiers.editor, source);
    modifiers.editor.refreshSelectionVisuals();
    modifiers.editor.events.onTransform(mesh);
    modifiers.editor.events.onStructure();
    const uvKept = Boolean(mesh.geometry.getAttribute('uv'));
    modifiers.onStatus(`Decimate применён · цель ~${Math.round(ratio * 100)}%${uvKept ? ' · UV сохранён' : ''}${groupCount ? ` · material groups ${groupCount}` : ''}`);
    return true;
  } catch (error) {
    console.error(error);
    modifiers.onStatus(`Decimate не выполнен: ${error.message || error}`);
    return false;
  }
}
