import { componentVisible } from '../edit/component-visibility.js';
import * as THREE from 'three';

// Collections are containers; selection acts on visible scene objects.
export function selectableObjects(editor) {
  const objects = [];
  editor.modelRoot?.traverseVisible?.((object) => {
    if (object !== editor.modelRoot && (object.isMesh || object.isLine || object.isPoints || object.isLight || object.isCamera)) objects.push(object);
  });
  return objects;
}

export function projectWorld(editor, world, rect) {
  const p = world.clone().project(editor.camera);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.z < -1 || p.z > 1) return null;
  return { x: rect.left + (p.x * .5 + .5) * rect.width, y: rect.top + (-p.y * .5 + .5) * rect.height };
}

export function projectEditVertices(editMode, rect) {
  editMode.mesh.updateWorldMatrix(true, false);
  return editMode.vertices.map((vertex,id) => componentVisible(editMode,'vertex',id) ? projectWorld(editMode.editor, vertex.position.clone().applyMatrix4(editMode.mesh.matrixWorld), rect) : null);
}

export function segmentDistanceSquared(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
}

export function segmentIntersectsRect(a, b, rect) {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, rect.left, rect.right], [a.y, b.y - a.y, rect.top, rect.bottom]]) {
    if (!delta) { if (start < min || start > max) return false; continue; }
    const u = (min - start) / delta, v = (max - start) / delta;
    low = Math.max(low, Math.min(u, v));
    high = Math.min(high, Math.max(u, v));
    if (low > high) return false;
  }
  return true;
}

export function objectCenter(editor, object, rect) {
  const box = new THREE.Box3().setFromObject(object);
  return projectWorld(editor, box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3()), rect);
}
