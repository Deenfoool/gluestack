import * as THREE from 'three';

const PICK_RADIUS_PX = 13;
const CLICK_SLOP_PX = 5;
const MAX_VISIBILITY_TESTS = 8;

function ensureStyle() {
  if (document.querySelector('style[data-vertex-picking-style]')) return;
  const style = document.createElement('style');
  style.dataset.vertexPickingStyle = '';
  style.textContent = `
    .edit-vertex-hover-ring{
      position:fixed;z-index:1200;width:18px;height:18px;border-radius:50%;
      border:1.5px solid #f0f0f0;box-shadow:0 0 0 2px rgba(0,0,0,.5),0 0 10px rgba(255,255,255,.18);
      transform:translate(-50%,-50%);pointer-events:none;display:none;
    }
    .edit-vertex-hover-ring.selected{border-color:#ff9b24;box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 12px rgba(255,155,36,.32)}
  `;
  document.head.appendChild(style);
}

function makeRing() {
  ensureStyle();
  const ring = document.createElement('div');
  ring.className = 'edit-vertex-hover-ring';
  ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ring);
  return ring;
}

export function installVertexPicking({ editor, editMode, knifeTool = null, boxSelect = null, circleSelect = null }) {
  if (!editor || !editMode || editor.__gluestackVertexPicking) return editor?.__gluestackVertexPicking ?? null;

  const canvas = editor.renderer.domElement;
  const hoverRing = makeRing();
  const visibilityRaycaster = new THREE.Raycaster();
  const world = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  let hovered = null;
  let pressed = null;
  let backgroundPress = null;
  let hoverFrame = 0;
  let pendingPointer = null;

  function blocked() {
    return !editMode.active
      || editMode.selectionMode !== 'vertex'
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
    hoverRing.style.display = 'none';
    if (restoreGizmo) setGizmoSuppressed(false);
  }

  function isVisibleCandidate(candidate) {
    const mesh = editMode.mesh;
    if (!mesh) return false;
    const camera = editor.camera;
    visibilityRaycaster.setFromCamera(new THREE.Vector2(candidate.ndcX, candidate.ndcY), camera);
    const previousMask = visibilityRaycaster.layers.mask;
    visibilityRaycaster.layers.mask = mesh.layers.mask;
    const first = visibilityRaycaster.intersectObject(mesh, false).find((hit) => {
      const internal = editMode.sourceFaceToTriangle?.[hit.faceIndex] ?? -1;
      return internal < 0 || !editMode.isTriangleHidden?.(internal);
    });
    visibilityRaycaster.layers.mask = previousMask;
    if (!first) return true;
    const candidateDistance = camera.position.distanceTo(candidate.world);
    const tolerance = Math.max(0.002, candidateDistance * 0.0015);
    return first.distance >= candidateDistance - tolerance;
  }

  function pick(clientX, clientY) {
    if (blocked()) return null;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;

    const mesh = editMode.mesh;
    mesh.updateWorldMatrix(true, false);
    const candidates = [];
    const radiusSq = PICK_RADIUS_PX * PICK_RADIUS_PX;

    for (let index = 0; index < editMode.vertices.length; index += 1) {
      if (editMode.isVertexHidden?.(index)) continue;
      const vertex = editMode.vertices[index];
      world.copy(vertex.position).applyMatrix4(mesh.matrixWorld);
      ndc.copy(world).project(editor.camera);
      if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1.08 || Math.abs(ndc.y) > 1.08) continue;

      const screenX = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const screenY = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const dx = clientX - screenX;
      const dy = clientY - screenY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radiusSq) continue;

      candidates.push({
        index,
        distanceSq,
        depth: ndc.z,
        screenX,
        screenY,
        ndcX: ndc.x,
        ndcY: ndc.y,
        world: world.clone(),
      });
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq || a.depth - b.depth);
    const shortlist = candidates.slice(0, MAX_VISIBILITY_TESTS);
    return shortlist.find(isVisibleCandidate) ?? candidates[0] ?? null;
  }

  function renderHover(candidate) {
    if (!candidate) {
      hideHover();
      return;
    }
    hovered = candidate;
    hoverRing.style.left = `${candidate.screenX}px`;
    hoverRing.style.top = `${candidate.screenY}px`;
    hoverRing.style.display = 'block';
    hoverRing.classList.toggle('selected', editMode.selectedVertices.has(candidate.index));
    setGizmoSuppressed(true);
  }

  function updateHover(event) {
    if (blocked()) {
      hideHover();
      return;
    }
    renderHover(pick(event.clientX, event.clientY));
  }

  function scheduleHover(event) {
    pendingPointer = { clientX: event.clientX, clientY: event.clientY };
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const pointer = pendingPointer;
      pendingPointer = null;
      if (pointer) updateHover(pointer);
    });
  }

  canvas.addEventListener('pointermove', scheduleHover, { capture: true });
  canvas.addEventListener('pointerleave', () => {
    pressed = null;
    backgroundPress = null;
    hideHover();
  }, { capture: true });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || blocked()) return;
    const candidate = pick(event.clientX, event.clientY);
    if (!candidate && editor.transform.axis) return;
    backgroundPress = {
      x: event.clientX,
      y: event.clientY,
      additive: event.shiftKey,
    };
    if (!candidate) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    pressed = {
      index: candidate.index,
      x: event.clientX,
      y: event.clientY,
      additive: event.shiftKey,
    };
    renderHover(candidate);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });

  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || (!pressed && !backgroundPress)) return;

    if (pressed) {
      const active = pressed;
      pressed = null;
      backgroundPress = null;
      const distance = Math.hypot(event.clientX - active.x, event.clientY - active.y);
      event.preventDefault();
      event.stopImmediatePropagation();
      editor.pointerStart = null;

      if (distance <= CLICK_SLOP_PX && editMode.active && editMode.selectionMode === 'vertex') {
        editMode.selectComponent(active.index, active.additive || event.shiftKey);
        renderHover(pick(event.clientX, event.clientY));
      } else {
        hideHover();
      }
      return;
    }

    const active = backgroundPress;
    backgroundPress = null;
    const distance = Math.hypot(event.clientX - active.x, event.clientY - active.y);
    if (distance > CLICK_SLOP_PX || blocked()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    editor.pointerStart = null;
    const candidate = pick(event.clientX, event.clientY);
    editMode.selectComponent(candidate?.index ?? null, active.additive || event.shiftKey);
    renderHover(candidate);
  }, { capture: true });

  window.addEventListener('blur', () => {
    pressed = null;
    backgroundPress = null;
    hideHover();
  });

  const previousSetSelectionMode = editMode.setSelectionMode.bind(editMode);
  editMode.setSelectionMode = (mode) => {
    const result = previousSetSelectionMode(mode);
    pressed = null;
    backgroundPress = null;
    if (mode !== 'vertex') hideHover();
    return result;
  };

  const previousExit = editMode.exit.bind(editMode);
  editMode.exit = (...args) => {
    pressed = null;
    backgroundPress = null;
    hideHover();
    return previousExit(...args);
  };

  const api = {
    radius: PICK_RADIUS_PX,
    pick,
    clearHover: hideHover,
    get hoveredVertex() { return hovered?.index ?? null; },
    dispose() {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      hoverRing.remove();
      hideHover();
    },
  };
  editor.__gluestackVertexPicking = api;
  return api;
}
