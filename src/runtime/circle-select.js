import { componentVisible } from '../edit/component-visibility.js';
import * as THREE from 'three';
import { selectableObjects, objectCenter, projectEditVertices, segmentDistanceSquared } from './selection-geometry.js';

function withinCircle(point, center, radius) {
  if (!point) return false;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy <= radius * radius;
}

function applyObjectCircle(editor, center, radius, subtract, rect) {
  const hits = selectableObjects(editor).filter((object) => withinCircle(objectCenter(editor, object, rect), center, radius));
  const selected = new Set(editor.getSelectedObjects());
  for (const object of hits) {
    if (subtract) selected.delete(object);
    else selected.add(object);
  }
  const next = [...selected];
  if (next.length) editor.selectMany(next, subtract ? (editor.selected && selected.has(editor.selected) ? editor.selected : next.at(-1)) : hits.at(-1) ?? next.at(-1));
  else editor.clearSelection();
  editor.events.onStatus(`Circle Select · ${subtract ? 'subtract' : 'add'} ${hits.length} object(s)`);
}

function applyEditCircle(editMode, center, radius, subtract, rect) {
  const target = editMode.currentSelectionSet();
  const points = projectEditVertices(editMode, rect);
  let hits = 0;
  const mutate = (key) => {
    if (subtract) target.delete(key);
    else target.add(key);
    hits += 1;
  };

  if (editMode.selectionMode === 'vertex') {
    editMode.vertices.forEach((_, vertexId) => {
      if (withinCircle(points[vertexId], center, radius)) mutate(vertexId);
    });
  } else if (editMode.selectionMode === 'edge') {
    for (const edge of editMode.logicalEdges) {
      if (!componentVisible(editMode,'edge',edge.key)) continue;
      const a = points[edge.a];
      const b = points[edge.b];
      if (!a || !b) continue;
      if (segmentDistanceSquared(center, a, b) <= radius * radius) mutate(edge.key);
    }
  } else {
    for (const group of editMode.faceGroups) {
      if (!componentVisible(editMode,'face',group.id)) continue;
      const vertices = new Set();
      for (const triangleIndex of group.triangles ?? []) {
        for (const vertexId of editMode.triangles[triangleIndex]?.v ?? []) vertices.add(vertexId);
      }
      let x = 0;
      let y = 0;
      let count = 0;
      for (const vertexId of vertices) {
        const point = points[vertexId];
        if (!point) continue;
        x += point.x;
        y += point.y;
        count += 1;
      }
      if (count && withinCircle({ x: x / count, y: y / count }, center, radius)) mutate(group.id);
    }
  }

  editMode.refreshOverlay();
  editMode.updatePivot();
  editMode.emitChange();
  editMode.status(`Circle Select · ${subtract ? 'subtract' : 'add'} ${hits} ${editMode.selectionMode}(s)`);
}

export function installCircleSelect({ editor, editMode }) {
  if (!editor || !editMode || editor.circleSelect) return editor?.circleSelect ?? null;
  const canvas = editor.renderer?.domElement;
  if (!canvas) return null;

  const circle = document.createElement('div');
  circle.className = 'circle-select-overlay';
  circle.hidden = true;
  document.body.appendChild(circle);
  const style = document.createElement('style');
  style.textContent = '.circle-select-overlay{position:fixed;z-index:901;pointer-events:none;border:1px solid rgba(255,149,0,.95);background:rgba(255,149,0,.06);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.28) inset}.circle-select-overlay[hidden]{display:none}';
  document.head.appendChild(style);

  let active = false;
  let painting = false;
  let subtract = false;
  let pointerId = null;
  let previousControls = null;
  let radius = 42;
  let center = { x: 0, y: 0 };

  function render() {
    circle.style.left = `${center.x - radius}px`;
    circle.style.top = `${center.y - radius}px`;
    circle.style.width = `${radius * 2}px`;
    circle.style.height = `${radius * 2}px`;
  }

  function begin() {
    if (active || document.body.classList.contains('gluestack-home-open')) return false;
    editor.boxSelect?.cancel();
    active = true;
    painting = false;
    circle.hidden = false;
    previousControls = { orbit: editor.orbit.enabled, transform: editor.transform?.enabled };
    editor.orbit.enabled = false;
    if (editor.transform) editor.transform.enabled = false;
    const rect = canvas.getBoundingClientRect();
    center = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    render();
    editor.events.onStatus(`Circle Select · radius ${radius}px · LMB add · Ctrl+LMB subtract · wheel radius · Enter/Esc finish`);
    return true;
  }

  function finish() {
    if (!active) return;
    active = false;
    painting = false;
    circle.hidden = true;
    editor.orbit.enabled = previousControls.orbit;
    if (editor.transform) editor.transform.enabled = previousControls.transform;
    pointerId = null;
    editor.events.onStatus(editMode.active ? `Edit Mode · ${editMode.selectionMode} Select` : 'Object Mode');
  }

  function applyAt(event) {
    const rect = canvas.getBoundingClientRect();
    if (center.x < rect.left || center.x > rect.right || center.y < rect.top || center.y > rect.bottom) return;
    if (editMode.active) applyEditCircle(editMode, center, radius, subtract, rect);
    else applyObjectCircle(editor, center, radius, subtract, rect);
  }

  function onPointerMove(event) {
    if (!active || (painting && event.pointerId !== pointerId)) return;
    const rect = canvas.getBoundingClientRect();
    circle.hidden = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    center = { x: event.clientX, y: event.clientY };
    render();
    if (painting) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyAt(event);
    }
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    center = { x: event.clientX, y: event.clientY };
    subtract = event.ctrlKey || event.metaKey;
    painting = true;
    pointerId = event.pointerId;
    circle.hidden = false;
    render();
    applyAt(event);
  }

  function onPointerUp(event) {
    if (!active || !painting || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    painting = false;
  }

  function onWheel(event) {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    radius = THREE.MathUtils.clamp(radius + (event.deltaY > 0 ? -6 : 6), 8, 240);
    render();
    editor.events.onStatus(`Circle Select · radius ${radius}px`);
  }

  canvas.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });

  window.addEventListener('pointercancel', finish);
  window.addEventListener('blur', finish);
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });

  new window.MutationObserver(() => { if (document.body.classList.contains('gluestack-home-open')) finish(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const api = { begin, finish, get active() { return active; }, get radius() { return radius; } };
  editor.circleSelect = api;
  return api;
}
