import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

export const SIMPLIFY_SAFE_ATTRIBUTES = new Set(['position', 'uv', 'normal', 'tangent', 'color']);

const simplifier = new SimplifyModifier();

export function hasMorphData(mesh) {
  if (mesh?.morphTargetInfluences?.length) return true;
  return Object.values(mesh?.geometry?.morphAttributes ?? {}).some((attributes) => attributes?.length);
}

export function unsupportedSimplifyAttributes(geometry) {
  return Object.keys(geometry?.attributes ?? {}).filter((name) => !SIMPLIFY_SAFE_ATTRIBUTES.has(name));
}

function groupPartitionIssue(mesh, total) {
  const groups = mesh.geometry?.groups ?? [];
  if (!groups.length) {
    if (Array.isArray(mesh.material) && mesh.material.length > 1) {
      return 'multi-material Mesh не содержит geometry groups';
    }
    return null;
  }

  const materialCount = Array.isArray(mesh.material) ? mesh.material.length : mesh.material ? 1 : 0;
  const sorted = groups.map((group) => ({
    start: Number(group.start ?? 0),
    count: Number(group.count ?? 0),
    materialIndex: Number(group.materialIndex ?? 0),
  })).sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const group of sorted) {
    if (![group.start, group.count, group.materialIndex].every(Number.isFinite)) return 'geometry groups содержат нечисловые значения';
    if (![group.start, group.count, group.materialIndex].every(Number.isInteger)) return 'geometry groups должны иметь целые start/count/materialIndex';
    if (group.start < 0 || group.count < 3 || group.start % 3 !== 0 || group.count % 3 !== 0) {
      return 'geometry groups должны быть выровнены по треугольникам';
    }
    if (group.start !== cursor) return 'geometry groups должны без пропусков покрывать всю geometry';
    if (group.start + group.count > total) return 'geometry group выходит за пределы geometry';
    if (group.materialIndex < 0 || group.materialIndex >= materialCount) return `geometry group ссылается на отсутствующий material slot ${group.materialIndex}`;
    cursor = group.start + group.count;
  }
  if (cursor !== total) return 'geometry groups должны полностью покрывать geometry';
  return null;
}

export function simplifyCompatibilityIssue(mesh) {
  if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.geometry?.getAttribute('position')) {
    return mesh?.isInstancedMesh
      ? 'InstancedMesh требует отдельного instance-aware simplification pipeline'
      : 'нужен обычный Mesh';
  }
  if (hasMorphData(mesh)) return 'morph targets требуют отдельного simplification pipeline';
  const unsupported = unsupportedSimplifyAttributes(mesh.geometry);
  if (unsupported.length) return `Three.js r180 SimplifyModifier не сохраняет атрибуты ${unsupported.join(', ')}`;

  const total = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
  const drawStart = mesh.geometry.drawRange?.start ?? 0;
  const drawCount = mesh.geometry.drawRange?.count;
  if (drawStart !== 0 || (Number.isFinite(drawCount) && drawCount < total)) {
    return 'нестандартный geometry.drawRange пока не поддерживается безопасным simplification pipeline';
  }
  return groupPartitionIssue(mesh, total);
}

function cloneAttributeRange(attribute, start, count) {
  const ArrayType = attribute.array.constructor;
  const values = new ArrayType(count * attribute.itemSize);
  for (let index = 0; index < count; index += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      values[index * attribute.itemSize + component] = attribute.getComponent(start + index, component);
    }
  }
  const clone = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
  clone.name = attribute.name;
  if (attribute.usage !== undefined) clone.setUsage(attribute.usage);
  return clone;
}

function sliceNonIndexedGeometry(source, start, count) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, cloneAttributeRange(attribute, start, count));
  }
  return geometry;
}

function simplifyPart(source, ratio) {
  let geometry = source.clone();
  if (!geometry.index) {
    const indexed = mergeVertices(geometry, 1e-5);
    if (indexed !== geometry) geometry.dispose();
    geometry = indexed;
  }

  const position = geometry.getAttribute('position');
  if (!position || position.count < 8) return geometry;

  const targetCount = Math.max(4, Math.floor(position.count * ratio));
  const removeCount = Math.max(0, Math.min(position.count - 4, position.count - targetCount));
  if (removeCount < 1) return geometry;

  const simplified = simplifier.modify(geometry, removeCount);
  geometry.dispose();
  simplified.computeBoundingBox();
  simplified.computeBoundingSphere();
  return simplified;
}

function normalizedGroups(geometry, totalCount) {
  if (!geometry.groups?.length) return [];
  return geometry.groups.map((group) => ({
    start: group.start,
    count: Math.min(group.count, totalCount - group.start),
    materialIndex: group.materialIndex ?? 0,
  }));
}

export function simplifyGeometryPreservingGroups(source, ratio = 0.5) {
  ratio = THREE.MathUtils.clamp(Number(ratio), 0.01, 0.99);
  if (!source?.getAttribute('position')) throw new Error('Geometry has no position attribute');

  const nonIndexed = source.index ? source.toNonIndexed() : source.clone();
  const total = nonIndexed.getAttribute('position')?.count ?? 0;
  const groups = normalizedGroups(source, total);

  if (!groups.length) {
    const simplified = simplifyPart(nonIndexed, ratio);
    nonIndexed.dispose();
    simplified.clearGroups();
    simplified.computeBoundingBox();
    simplified.computeBoundingSphere();
    return { geometry: simplified, groupsPreserved: true, groupCount: 0 };
  }

  const parts = [];
  try {
    for (const group of groups) {
      const part = sliceNonIndexedGeometry(nonIndexed, group.start, group.count);
      const simplified = simplifyPart(part, ratio);
      part.dispose();
      const position = simplified.getAttribute('position');
      if (!position || position.count < 3) {
        simplified.dispose();
        continue;
      }
      parts.push({ geometry: simplified, materialIndex: group.materialIndex });
    }

    if (!parts.length) throw new Error('Simplification removed all material groups');
    const merged = mergeGeometries(parts.map((part) => part.geometry), true);
    if (!merged) throw new Error('Material groups could not be merged after simplification');
    merged.groups.forEach((group, index) => {
      group.materialIndex = parts[index]?.materialIndex ?? 0;
    });
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return { geometry: merged, groupsPreserved: true, groupCount: merged.groups.length };
  } finally {
    nonIndexed.dispose();
    for (const part of parts) part.geometry.dispose();
  }
}
