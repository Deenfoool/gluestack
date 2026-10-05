import * as THREE from 'three';

const PICK_RADIUS_PX = 9;
const CLICK_SLOP_PX = 5;
const MAX_VISIBILITY_TESTS = 10;

function ensureStyle() {
  if (document.querySelector('style[data-edge-picking-style]')) return;
  const style = document.createElement('style');
  style.dataset.edgePickingStyle = '';
  style.textContent = `
    .edit-edge-hover-line{
      position:fixed;z-index:1200;height:2px;transform-origin:0 50%;pointer-events:none;display:none;
      background:#efefef;box-shadow:0 0 0 1px rgba(0,0,0,.45),0 0 9px rgba(255,255,255,.16);
    }
    .edit-edge-hover-line.selected{background:#ff9b24;box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 10px rgba(255,155,36,.28)}
  `;
  document.head.appendChild(style);
}

function makeLine() {
  ensureStyle();
  const element = document.createElement('div');
  element.className = 'edit-edge-hover-line';
  element.setAttribute('aria-hidden', 'true');
  document.body.appendChild(element);
  return element;
}

function segmentDistanceSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-6) return { distanceSq: (px - ax) ** 2 + (py - ay) ** 2, t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  const x = ax + abx * t;
  const y = ay + aby * t;
  return { distanceSq: (px - x) ** 2 + (py - y) ** 2, t };
}

export function installEdgePicking({ editor, editMode, knifeTool = null, boxSelect = null, circleSelect = null }) {
  if (!editor || !editMode || editor.__gluestackEdgePicking) return editor?.__gluestackEdgePicking ?? null;

  const canvas = editor.renderer.domElement;
  const hoverLine = makeLine();
  const visibilityRaycaster = new THREE.Raycaster();
  const aWorld = new THREE.Vector3();
  const bWorld = new THREE.Vector3();
  const aNdc = new THREE.Vector3();
  const bNdc = new THREE.Vector3();
  let hovered = null;
  let pressed = null;
  let frame = 0;
  let pendingPointer = null;

  function blocked() {
    return !editMode.active
      || editMode.selectionMode !== 'edge'
      || !editMode.mesh
      || editor.transform.dragging
      || knifeTool?.active
      || boxSelect?.active
      || circleSelect?.active
      || window.__gluestackEditModalTools?.active
      || window.__gluestackUVModalTransform?.active
      || editMode.editUX?.slide?.active
      || window.__gluestackHome?.visible;
  }

  function helper() {
    return editor.transform?.getHelper?.() ?? null;
  }

  function setGizmoSuppressed(value) {
    const gizmo = helper();
    if (!gizmo || editor.transform.dragging) return;
    gizmo.visible = value ? false : Boolean(editor.transform.object);
  }

  function hideHover({ restoreGizmo = true } = {}) {
    hovered = null;
    hoverLine.style.display = 'none';
    if (restoreGizmo) setGizmoSuppressed(false);
  }

  function visibleCandidate(candidate) {
    const mesh = editMode.mesh;
    const camera = editor.camera;
    const midNdc = new THREE.Vector2(
      candidate.aNdc.x + (candidate.bNdc.x - candidate.aNdc.x) * candidate.t,
      candidate.aNdc.y + (candidate.bNdc.y - candidate.aNdc.y) * candidate.t,
    );
    visibilityRaycaster.setFromCamera(midNdc, camera);
    const previousMask = visibilityRaycaster.layers.mask;
    visibilityRaycaster.layers.mask = mesh.layers.mask;
    const first = visibilityRaycaster.intersectObject(mesh, false).find((hit) => {
      const internal = editMode.sourceFaceToTriangle[hit.faceIndex];
      return internal < 0 || !editMode.isTriangleHidden?.(internal);
    });
    visibilityRaycaster.layers.mask = previousMask;
    if (!first) return true;
    const point = candidate.aWorld.clone().lerp(candidate.bWorld, candidate.t);
    const edgeDistance = camera.position.distanceTo(point);
    const tolerance = Math.max(0.002, edgeDistance * 0.002);
    return first.distance >= edgeDistance - tolerance;
  }

  function pick(clientX, clientY) {
    if (blocked()) return null;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;

    const mesh = editMode.mesh;
    mesh.updateWorldMatrix(true, false);
    const radiusSq = PICK_RADIUS_PX * PICK_RADIUS_PX;
    const candidates = [];

    for (const edge of editMode.logicalEdges) {
      if (editMode.isEdgeHidden?.(edge)) continue;
      const a = editMode.vertices[edge.a]?.position;
      const b = editMode.vertices[edge.b]?.position;
      if (!a || !b) continue;
      aWorld.copy(a).applyMatrix4(mesh.matrixWorld);
      bWorld.copy(b).applyMatrix4(mesh.matrixWorld);
      aNdc.copy(aWorld).project(editor.camera);
      bNdc.copy(bWorld).project(editor.camera);
      if ((aNdc.z < -1 && bNdc.z < -1) || (aNdc.z > 1 && bNdc.z > 1)) continue;

      const ax = rect.left + (aNdc.x * 0.5 + 0.5) * rect.width;
      const ay = rect.top + (-aNdc.y * 0.5 + 0.5) * rect.height;
      const bx = rect.left + (bNdc.x * 0.5 + 0.5) * rect.width;
      const by = rect.top + (-bNdc.y * 0.5 + 0.5) * rect.height;
      const distance = segmentDistanceSq(clientX, clientY, ax, ay, bx, by);
      if (distance.distanceSq > radiusSq) continue;
      candidates.push({
        edge,
        distanceSq: distance.distanceSq,
        t: distance.t,
        ax, ay, bx, by,
        aWorld: aWorld.clone(),
        bWorld: bWorld.clone(),
        aNdc: aNdc.clone(),
        bNdc: bNdc.clone(),
        depth: aNdc.z + (bNdc.z - aNdc.z) * distance.t,
      });
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq || a.depth - b.depth);
    const shortlist = candidates.slice(0, MAX_VISIBILITY_TESTS);
    return shortlist.find(visibleCandidate) ?? candidates[0] ?? null;
  }

  function renderHover(candidate) {
    if (!candidate) {
      hideHover();
      return;
    }
    hovered = candidate;
    const dx = candidate.bx - candidate.ax;
    const dy = candidate.by - candidate.ay;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    hoverLine.style.left = `${candidate.ax}px`;
    hoverLine.style.top = `${candidate.ay}px`;
    hoverLine.style.width = `${length}px`;
    hoverLine.style.transform = `rotate(${angle}deg)`;
    hoverLine.style.display = 'block';
    hoverLine.classList.toggle('selected', editMode.selectedEdges.has(candidate.edge.key));
    setGizmoSuppressed(true);
  }

  function scheduleHover(event) {
    pendingPointer = { clientX: event.clientX, clientY: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const pointer = pendingPointer;
      pendingPointer = null;
      if (!pointer || blocked()) {
        hideHover();
        return;
      }
      renderHover(pick(pointer.clientX, pointer.clientY));
    });
  }

  canvas.addEventListener('pointermove', scheduleHover, { capture: true });
  canvas.addEventListener('pointerleave', () => {
    pressed = null;
    hideHover();
  }, { capture: true });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || blocked()) return;
    const candidate = pick(event.clientX, event.clientY);
    if (!candidate && editor.transform.axis) return;
    pressed = {
      key: candidate?.edge?.key ?? null,
      x: event.clientX,
      y: event.clientY,
      additive: event.shiftKey,
      loop: event.altKey,
    };
    if (candidate) renderHover(candidate);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });

  canvas.addEventListener('pointerup', (event) => {
    if (!pressed || event.button !== 0) return;
    const active = pressed;
    pressed = null;
    const moved = Math.hypot(event.clientX - active.x, event.clientY - active.y);
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.pointerStart = null;
    if (moved > CLICK_SLOP_PX || !editMode.active || editMode.selectionMode !== 'edge') {
      hideHover();
      return;
    }
    if (active.loop && active.key) editMode.editUX?.selectEdgeLoopFrom?.(active.key, active.additive || event.shiftKey);
    else editMode.selectEdgeKey(active.key, active.additive || event.shiftKey);
    renderHover(pick(event.clientX, event.clientY));
  }, { capture: true });

  window.addEventListener('blur', () => {
    pressed = null;
    hideHover();
  });

  const api = {
    radius: PICK_RADIUS_PX,
    pick,
    clearHover: hideHover,
    get hoveredEdge() { return hovered?.edge?.key ?? null; },
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      hoverLine.remove();
      hideHover();
    },
  };
  editor.__gluestackEdgePicking = api;
  return api;
}
