import * as THREE from 'three';
import { selectableObjects, projectWorld, projectEditVertices, segmentIntersectsRect } from './selection-geometry.js';

function rectFromPoints(a, b) {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  };
}

function contains(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function overlaps(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function objectScreenBounds(editor, object, canvasRect) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    const point = projectWorld(editor, object.getWorldPosition(new THREE.Vector3()), canvasRect);
    return point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : null;
  }
  const { min, max } = box;
  const corners = [
    [min.x, min.y, min.z], [max.x, min.y, min.z], [min.x, max.y, min.z], [max.x, max.y, min.z],
    [min.x, min.y, max.z], [max.x, min.y, max.z], [min.x, max.y, max.z], [max.x, max.y, max.z],
  ];
  const projected = corners
    .map(([x, y, z]) => projectWorld(editor, new THREE.Vector3(x, y, z), canvasRect))
    .filter(Boolean);
  if (!projected.length) return null;
  return {
    left: Math.min(...projected.map((p) => p.x)),
    right: Math.max(...projected.map((p) => p.x)),
    top: Math.min(...projected.map((p) => p.y)),
    bottom: Math.max(...projected.map((p) => p.y)),
  };
}

function selectObjects(editor, rect, additive, subtract, canvasRect) {
  const hits = selectableObjects(editor).filter((object) => {
    const bounds = objectScreenBounds(editor, object, canvasRect);
    return bounds && overlaps(rect, bounds);
  });
  if (additive || subtract) {
    const merged = subtract ? editor.getSelectedObjects().filter(object => !hits.includes(object)) : [...new Set([...editor.getSelectedObjects(), ...hits])];
    if (merged.length) editor.selectMany(merged, merged.includes(editor.selected) ? editor.selected : merged.at(-1));
    else editor.clearSelection();
  } else if (hits.length) {
    editor.selectMany(hits, hits.at(-1));
  } else {
    editor.clearSelection();
  }
  editor.events.onStatus(`Box Select · ${hits.length} object(s)`);
  return hits.length;
}

function selectEdit(editMode, rect, additive, subtract, canvasRect) {
  const target = editMode.currentSelectionSet();
  if (!additive && !subtract) target.clear();
  const points = projectEditVertices(editMode, canvasRect);
  const mutate = key => subtract ? target.delete(key) : target.add(key);
  let hits = 0;

  if (editMode.selectionMode === 'vertex') {
    editMode.vertices.forEach((_, vertexId) => {
      const p = points[vertexId];
      if (!p || !contains(rect, p.x, p.y)) return;
      mutate(vertexId);
      hits += 1;
    });
  } else if (editMode.selectionMode === 'edge') {
    for (const edge of editMode.logicalEdges) {
      const a = points[edge.a];
      const b = points[edge.b];
      if (!a || !b) continue;
      if (!segmentIntersectsRect(a, b, rect)) continue;
      mutate(edge.key);
      hits += 1;
    }
  } else {
    for (const group of editMode.faceGroups) {
      const vertices = new Set();
      for (const triangleIndex of group.triangles ?? []) {
        for (const vertexId of editMode.triangles[triangleIndex]?.v ?? []) vertices.add(vertexId);
      }
      if (!vertices.size) continue;
      let x = 0;
      let y = 0;
      let count = 0;
      for (const vertexId of vertices) {
        const p = points[vertexId];
        if (!p) continue;
        x += p.x;
        y += p.y;
        count += 1;
      }
      if (!count || !contains(rect, x / count, y / count)) continue;
      mutate(group.id);
      hits += 1;
    }
  }

  editMode.refreshOverlay();
  editMode.updatePivot();
  editMode.emitChange();
  editMode.status(`Box Select · ${hits} ${editMode.selectionMode}(s)`);
  return hits;
}

export function installBoxSelect({ editor, editMode }) {
  if (!editor || !editMode || editor.boxSelect) return editor?.boxSelect ?? null;
  const canvas = editor.renderer?.domElement;
  if (!canvas) return null;

  const overlay = document.createElement('div');
  overlay.className = 'box-select-overlay';
  overlay.hidden = true;
  document.body.appendChild(overlay);
  const style = document.createElement('style');
  style.textContent = '.box-select-overlay{position:fixed;z-index:900;pointer-events:none;border:1px solid rgba(255,149,0,.95);background:rgba(255,149,0,.12);box-shadow:0 0 0 1px rgba(0,0,0,.25) inset}.box-select-overlay[hidden]{display:none}';
  document.head.appendChild(style);

  let active = false;
  let dragging = false;
  let start = null;
  let additive = false;
  let subtract = false;
  let pointerId = null;
  let previousControls = null;

  function updateOverlay(current) {
    const rect = rectFromPoints(start, current);
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${Math.max(1, rect.right - rect.left)}px`;
    overlay.style.height = `${Math.max(1, rect.bottom - rect.top)}px`;
  }

  function begin() {
    if (active || document.body.classList.contains('gluestack-home-open')) return false;
    editor.circleSelect?.finish();
    active = true;
    previousControls = { orbit: editor.orbit.enabled, transform: editor.transform?.enabled };
    editor.orbit.enabled = false;
    if (editor.transform) editor.transform.enabled = false;
    editor.events.onStatus(`Box Select · drag LMB${editMode.active ? ` · ${editMode.selectionMode}` : ''} · Esc cancel`);
    return true;
  }

  function cancel() {
    if (!active) return;
    active = false;
    dragging = false;
    start = null;
    overlay.hidden = true;
    editor.orbit.enabled = previousControls.orbit;
    if (editor.transform) editor.transform.enabled = previousControls.transform;
    pointerId = null;
    editor.events.onStatus(editMode.active ? `Edit Mode · ${editMode.selectionMode} Select` : 'Object Mode');
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    if (!contains({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, event.clientX, event.clientY)) return;
    dragging = true;
    additive = event.shiftKey;
    subtract = event.ctrlKey || event.metaKey;
    pointerId = event.pointerId;
    start = { x: event.clientX, y: event.clientY };
    overlay.hidden = false;
    updateOverlay(start);
  }

  function onPointerMove(event) {
    if (!active || !dragging || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    updateOverlay({ x: event.clientX, y: event.clientY });
  }

  function onPointerUp(event) {
    if (!active || !dragging || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selectionRect = rectFromPoints(start, { x: event.clientX, y: event.clientY });
    const canvasRect = canvas.getBoundingClientRect();
    if (editMode.active) selectEdit(editMode, selectionRect, additive, subtract, canvasRect);
    else selectObjects(editor, selectionRect, additive, subtract, canvasRect);
    active = false;
    dragging = false;
    start = null;
    overlay.hidden = true;
    editor.orbit.enabled = previousControls.orbit;
    if (editor.transform) editor.transform.enabled = previousControls.transform;
    pointerId = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);

  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });

  new window.MutationObserver(() => { if (document.body.classList.contains('gluestack-home-open')) cancel(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const api = { begin, cancel, get active() { return active; } };
  editor.boxSelect = api;
  return api;
}
