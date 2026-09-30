import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ADDITION,
  SUBTRACTION,
  INTERSECTION,
  Brush,
  Evaluator,
} from 'three-bvh-csg';
import { readMeshTopology } from '../edit/topology.js';

const OPERATIONS = {
  union: ADDITION,
  difference: SUBTRACTION,
  intersect: INTERSECTION,
};
const BOOLEAN_ATTRIBUTES = new Set(['position', 'normal', 'uv']);

function isRegularMesh(object) {
  return object?.isMesh && !object.isSkinnedMesh && object.geometry?.getAttribute('position');
}

function unsupportedAttributes(mesh) {
  return Object.keys(mesh.geometry?.attributes ?? {}).filter((name) => !BOOLEAN_ATTRIBUTES.has(name));
}

function hasMorphData(mesh) {
  if (mesh.morphTargetInfluences?.length) return true;
  return Object.values(mesh.geometry?.morphAttributes ?? {}).some((attributes) => attributes?.length);
}

function isWatertight(mesh) {
  const topology = readMeshTopology(mesh);
  return topology.edges.length > 0 && topology.edges.every((edge) => edge.triangles.length === 2);
}

function prepareGeometry(mesh) {
  mesh.updateWorldMatrix(true, false);
  let geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) {
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  geometry.clearGroups();
  if (!geometry.index) {
    const indexed = mergeVertices(geometry, 1e-5);
    geometry.dispose();
    geometry = indexed;
  }
  return geometry;
}

function trimDrawRange(geometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const total = source.getAttribute('position')?.count ?? 0;
  const start = Math.max(0, geometry.drawRange?.start ?? 0);
  const requested = geometry.drawRange?.count;
  const count = Number.isFinite(requested) ? Math.max(0, Math.min(requested, total - start)) : total - start;
  const result = new THREE.BufferGeometry();

  for (const [name, attribute] of Object.entries(source.attributes)) {
    const from = start * attribute.itemSize;
    const to = (start + count) * attribute.itemSize;
    const array = attribute.array.slice(from, to);
    result.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  source.dispose();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

export function applyBoolean(modifiers, operation = 'difference') {
  const active = modifiers.editor.selected;
  const selected = modifiers.editor.getSelectedObjects().filter(isRegularMesh);
  if (!isRegularMesh(active) || selected.length !== 2 || !selected.includes(active)) {
    modifiers.onStatus('Boolean: выделите ровно 2 обычных Mesh; активный объект — A, второй — B');
    return false;
  }
  const operand = selected.find((mesh) => mesh !== active);
  if (!OPERATIONS[operation]) return false;
  if (Array.isArray(active.material) || Array.isArray(operand.material)) {
    modifiers.onStatus('Boolean: multi-material Mesh пока не поддерживается');
    return false;
  }
  if (hasMorphData(active) || hasMorphData(operand)) {
    modifiers.onStatus('Boolean: morph targets не поддерживаются без потери данных');
    return false;
  }
  const unsupported = [...new Set([...unsupportedAttributes(active), ...unsupportedAttributes(operand)])];
  if (unsupported.length) {
    modifiers.onStatus(`Boolean отменён: будут потеряны атрибуты ${unsupported.join(', ')}`);
    return false;
  }
  if (!isWatertight(active) || !isWatertight(operand)) {
    modifiers.onStatus('Boolean: оба Mesh должны быть watertight / two-manifold');
    return false;
  }

  let geometryA;
  let geometryB;
  let result;
  try {
    geometryA = prepareGeometry(active);
    geometryB = prepareGeometry(operand);
    const brushA = new Brush(geometryA);
    const brushB = new Brush(geometryB);
    brushA.updateMatrixWorld(true);
    brushB.updateMatrixWorld(true);

    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal', 'uv'];
    evaluator.useGroups = false;
    result = evaluator.evaluate(brushA, brushB, OPERATIONS[operation]);
    if (!result?.geometry?.getAttribute('position')?.count) {
      modifiers.onStatus('Boolean: результат пуст');
      result?.geometry?.dispose?.();
      geometryA.dispose();
      geometryB.dispose();
      return false;
    }

    const geometry = trimDrawRange(result.geometry);
    const inverseWorld = active.matrixWorld.clone().invert();
    geometry.applyMatrix4(inverseWorld);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    modifiers.editor.checkpoint(`Boolean ${operation}`);
    active.geometry.dispose();
    active.geometry = geometry;
    modifiers.editor.select(active);
    modifiers.editor.events.onStructure();
    modifiers.editor.events.onTransform(active);
    modifiers.onStatus(`Boolean ${operation} применён · cutter сохранён`);

    result.geometry.dispose();
    geometryA.dispose();
    geometryB.dispose();
    return true;
  } catch (error) {
    console.error(error);
    result?.geometry?.dispose?.();
    geometryA?.dispose?.();
    geometryB?.dispose?.();
    modifiers.onStatus(`Boolean не выполнен: ${error.message || error}`);
    return false;
  }
}
