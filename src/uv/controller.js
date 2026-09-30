import * as THREE from 'three';

const EPS = 1e-5;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const positionKey = (v) => `${Math.round(v.x / EPS)}:${Math.round(v.y / EPS)}:${Math.round(v.z / EPS)}`;
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const geometricEdgeKey = (a, b) => {
  const ka = positionKey(a);
  const kb = positionKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

function pointInTriangle(p, a, b, c) {
  const s1 = (p.x - c.x) * (a.y - c.y) - (a.x - c.x) * (p.y - c.y);
  const s2 = (p.x - a.x) * (b.y - a.y) - (b.x - a.x) * (p.y - a.y);
  const s3 = (p.x - b.x) * (c.y - b.y) - (c.x - b.x) * (p.y - b.y);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}

function distanceToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq));
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

function triangleArea3D(a, b, c) {
  return new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(c, a),
  ).length() * 0.5;
}

function triangleArea2D(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
}

export class UVController {
  constructor(editor, elements, onStatus = null) {
    this.editor = editor;
    this.elements = elements;
    this.status = onStatus ?? ((message) => editor.events.onStatus(message));
    this.canvas = elements.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.mesh = null;
    this.mode = 'vertex';
    this.selected = new Set();
    this.triangles = [];
    this.islands = [];
    this.cornerToIsland = [];
    this.zoom = 1;
    this.pan = new THREE.Vector2();
    this.drag = null;
    this.textureImage = null;
    this.seams = new Set();

    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.canvas.addEventListener('pointerleave', (event) => this.pointerUp(event));
    this.canvas.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
  }

  open(mesh = this.editor.selected) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || !mesh.geometry?.getAttribute('position')) {
      this.status('UV Editing: выберите обычный Mesh');
      return false;
    }
    this.mesh = mesh;
    this.ensureCornerGeometry();
    this.ensureUV();
    this.loadSeams();
    this.rebuildTopology();
    this.selected.clear();
    this.fit();
    this.render();
    this.status(`UV Editing · ${mesh.name || 'Mesh'} · ${this.islands.length} island(s)`);
    return true;
  }

  close() {
    this.mesh = null;
    this.selected.clear();
    this.triangles = [];
    this.islands = [];
    this.render();
  }

  ensureCornerGeometry() {
    if (!this.mesh.geometry.index) return;
    this.editor.checkpoint('Prepare UV corners');
    const old = this.mesh.geometry;
    const next = old.toNonIndexed();
    next.computeBoundingBox();
    next.computeBoundingSphere();
    this.mesh.geometry = next;
    old.dispose();
  }

  ensureUV() {
    const geometry = this.mesh.geometry;
    const position = geometry.getAttribute('position');
    if (geometry.getAttribute('uv')?.count === position.count) return;
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2));
    this.projectCube(false);
  }

  loadSeams() {
    this.seams = new Set(this.mesh.userData.gluestackUVSeams ?? []);
  }

  saveSeams() {
    this.mesh.userData.gluestackUVSeams = [...this.seams];
  }

  rebuildTopology() {
    if (!this.mesh) return;
    const geometry = this.mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const count = Math.floor(position.count / 3);
    this.triangles = [];
    const edgeOwners = new Map();

    for (let t = 0; t < count; t += 1) {
      const corners = [t * 3, t * 3 + 1, t * 3 + 2];
      const positions = corners.map((i) => new THREE.Vector3().fromBufferAttribute(position, i));
      const uvs = corners.map((i) => new THREE.Vector2().fromBufferAttribute(uv, i));
      const normal = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(positions[1], positions[0]),
        new THREE.Vector3().subVectors(positions[2], positions[0]),
      ).normalize();
      const triangle = { id: t, corners, positions, uvs, normal, neighbors: new Set() };
      this.triangles.push(triangle);
      for (let e = 0; e < 3; e += 1) {
        const a = positions[e];
        const b = positions[(e + 1) % 3];
        const key = geometricEdgeKey(a, b);
        if (!edgeOwners.has(key)) edgeOwners.set(key, []);
        edgeOwners.get(key).push({ triangle: t, edge: e });
      }
    }

    for (const [key, owners] of edgeOwners) {
      if (owners.length !== 2 || this.seams.has(key)) continue;
      const [a, b] = owners;
      if (!this.edgeUVContinuous(a, b)) continue;
      this.triangles[a.triangle].neighbors.add(b.triangle);
      this.triangles[b.triangle].neighbors.add(a.triangle);
    }

    this.islands = [];
    this.cornerToIsland = new Array(position.count).fill(-1);
    const visited = new Set();
    for (let start = 0; start < this.triangles.length; start += 1) {
      if (visited.has(start)) continue;
      const queue = [start];
      const triangleIds = [];
      visited.add(start);
      while (queue.length) {
        const id = queue.pop();
        triangleIds.push(id);
        for (const neighbor of this.triangles[id].neighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
      const islandId = this.islands.length;
      const corners = new Set();
      triangleIds.forEach((id) => this.triangles[id].corners.forEach((corner) => {
        corners.add(corner);
        this.cornerToIsland[corner] = islandId;
      }));
      this.islands.push({ id: islandId, triangles: triangleIds, corners });
    }
    this.updateInfo();
  }

  edgeUVContinuous(ownerA, ownerB) {
    const ta = this.triangles[ownerA.triangle];
    const tb = this.triangles[ownerB.triangle];
    const aPairs = [
      { p: ta.positions[ownerA.edge], uv: ta.uvs[ownerA.edge] },
      { p: ta.positions[(ownerA.edge + 1) % 3], uv: ta.uvs[(ownerA.edge + 1) % 3] },
    ];
    const bPairs = [
      { p: tb.positions[ownerB.edge], uv: tb.uvs[ownerB.edge] },
      { p: tb.positions[(ownerB.edge + 1) % 3], uv: tb.uvs[(ownerB.edge + 1) % 3] },
    ];
    return aPairs.every((ap) => bPairs.some((bp) => (
      ap.p.distanceToSquared(bp.p) < EPS * EPS && ap.uv.distanceToSquared(bp.uv) < EPS * EPS
    )));
  }

  setMode(mode) {
    if (!['vertex', 'edge', 'island'].includes(mode)) return;
    this.mode = mode;
    this.selected.clear();
    this.render();
    this.updateInfo();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  uvToScreen(uv) {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) * 0.82 * this.zoom;
    const ox = rect.width * 0.5 - size * 0.5 + this.pan.x;
    const oy = rect.height * 0.5 - size * 0.5 + this.pan.y;
    return new THREE.Vector2(ox + uv.x * size, oy + (1 - uv.y) * size);
  }

  screenToUV(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) * 0.82 * this.zoom;
    const ox = rect.width * 0.5 - size * 0.5 + this.pan.x;
    const oy = rect.height * 0.5 - size * 0.5 + this.pan.y;
    return new THREE.Vector2((x - ox) / size, 1 - ((y - oy) / size));
  }

  render() {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, rect.width, rect.height);
    this.drawChecker();
    if (!this.mesh) {
      ctx.fillStyle = '#888';
      ctx.font = '12px system-ui';
      ctx.fillText('Select a Mesh to edit UVs', 16, 24);
      return;
    }

    for (const triangle of this.triangles) {
      const points = triangle.uvs.map((uv) => this.uvToScreen(uv));
      const islandSelected = this.mode === 'island' && this.selected.has(this.cornerToIsland[triangle.corners[0]]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.lineTo(points[2].x, points[2].y);
      ctx.closePath();
      if (islandSelected) {
        ctx.fillStyle = 'rgba(232,138,26,.18)';
        ctx.fill();
      }
      ctx.strokeStyle = islandSelected ? '#ff9f2e' : '#b4b4b4';
      ctx.lineWidth = islandSelected ? 1.6 : 1;
      ctx.stroke();
    }

    if (this.mode === 'edge') this.drawEdges();
    else if (this.mode === 'vertex') this.drawVertices();
  }

  drawChecker() {
    const ctx = this.ctx;
    const a = this.uvToScreen(new THREE.Vector2(0, 0));
    const b = this.uvToScreen(new THREE.Vector2(1, 1));
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const size = Math.abs(b.x - a.x);
    const cell = Math.max(8, size / 16);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, size, size);
    ctx.clip();
    if (this.textureImage) {
      ctx.drawImage(this.textureImage, left, top, size, size);
    } else {
      for (let y = 0; y < Math.ceil(size / cell); y += 1) {
        for (let x = 0; x < Math.ceil(size / cell); x += 1) {
          ctx.fillStyle = (x + y) % 2 ? '#303030' : '#262626';
          ctx.fillRect(left + x * cell, top + y * cell, cell, cell);
        }
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#616161';
    ctx.strokeRect(left, top, size, size);
  }

  drawVertices() {
    const ctx = this.ctx;
    const uv = this.mesh.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) {
      const p = this.uvToScreen(new THREE.Vector2().fromBufferAttribute(uv, i));
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.selected.has(i) ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = this.selected.has(i) ? '#ff9f2e' : '#d7d7d7';
      ctx.fill();
    }
  }

  drawEdges() {
    const ctx = this.ctx;
    for (const triangle of this.triangles) {
      for (let e = 0; e < 3; e += 1) {
        const a = triangle.corners[e];
        const b = triangle.corners[(e + 1) % 3];
        const key = edgeKey(a, b);
        if (!this.selected.has(key)) continue;
        const p1 = this.uvToScreen(triangle.uvs[e]);
        const p2 = this.uvToScreen(triangle.uvs[(e + 1) % 3]);
        ctx.strokeStyle = '#ff9f2e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  pointerDown(event) {
    if (!this.mesh) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (event.button === 1 || event.button === 2) {
      this.drag = { type: 'pan', x: event.clientX, y: event.clientY, pan: this.pan.clone() };
      event.preventDefault();
      return;
    }
    const hit = this.pick(x, y);
    if (!event.shiftKey) this.selected.clear();
    if (hit !== null) {
      if (event.shiftKey && this.selected.has(hit)) this.selected.delete(hit);
      else this.selected.add(hit);
    }
    this.drag = { type: 'move', x: event.clientX, y: event.clientY, startUV: this.captureSelectedUVs() };
    this.render();
    this.updateInfo();
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  pointerMove(event) {
    if (!this.drag) return;
    if (this.drag.type === 'pan') {
      this.pan.set(
        this.drag.pan.x + event.clientX - this.drag.x,
        this.drag.pan.y + event.clientY - this.drag.y,
      );
      this.render();
      return;
    }
    if (!this.selected.size) return;
    const rect = this.canvas.getBoundingClientRect();
    const start = this.screenToUV(this.drag.x - rect.left, this.drag.y - rect.top);
    const current = this.screenToUV(event.clientX - rect.left, event.clientY - rect.top);
    const delta = current.sub(start);
    this.applyCapturedTransform(this.drag.startUV, (uv) => uv.add(delta));
  }

  pointerUp(event) {
    if (!this.drag) return;
    if (this.drag.type === 'move' && this.selected.size) {
      this.editor.commitHistory();
      this.status('UV Move');
    }
    this.drag = null;
    try { this.canvas.releasePointerCapture?.(event.pointerId); } catch {}
  }

  wheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.2, 8);
    this.render();
  }

  pick(x, y) {
    if (this.mode === 'vertex') {
      let best = null;
      let bestDist = 9;
      const uv = this.mesh.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i += 1) {
        const p = this.uvToScreen(new THREE.Vector2().fromBufferAttribute(uv, i));
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    }
    if (this.mode === 'edge') {
      let best = null;
      let bestDist = 8;
      for (const triangle of this.triangles) {
        for (let e = 0; e < 3; e += 1) {
          const a = this.uvToScreen(triangle.uvs[e]);
          const b = this.uvToScreen(triangle.uvs[(e + 1) % 3]);
          const d = distanceToSegment({ x, y }, a, b);
          if (d < bestDist) {
            bestDist = d;
            best = edgeKey(triangle.corners[e], triangle.corners[(e + 1) % 3]);
          }
        }
      }
      return best;
    }
    for (const triangle of this.triangles) {
      const p = triangle.uvs.map((uv) => this.uvToScreen(uv));
      if (pointInTriangle({ x, y }, p[0], p[1], p[2])) return this.cornerToIsland[triangle.corners[0]];
    }
    return null;
  }

  selectedCornerIds() {
    if (this.mode === 'vertex') return new Set([...this.selected]);
    if (this.mode === 'edge') {
      const result = new Set();
      for (const key of this.selected) key.split('|').map(Number).forEach((id) => result.add(id));
      return result;
    }
    const result = new Set();
    for (const islandId of this.selected) this.islands[islandId]?.corners.forEach((id) => result.add(id));
    return result;
  }

  captureSelectedUVs() {
    if (!this.selected.size) return [];
    this.editor.beginHistory('UV transform');
    const uv = this.mesh.geometry.getAttribute('uv');
    return [...this.selectedCornerIds()].map((id) => ({ id, uv: new THREE.Vector2().fromBufferAttribute(uv, id) }));
  }

  applyCapturedTransform(snapshot, transform) {
    const uv = this.mesh.geometry.getAttribute('uv');
    for (const item of snapshot) {
      const next = transform(item.uv.clone());
      uv.setXY(item.id, next.x, next.y);
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.render();
  }

  moveSelected(x, y) {
    const snapshot = this.captureSelectedUVs();
    if (!snapshot.length) return false;
    this.applyCapturedTransform(snapshot, (uv) => uv.add(new THREE.Vector2(x, y)));
    this.editor.commitHistory();
    this.status(`UV Move ${x}, ${y}`);
    return true;
  }

  rotateSelected(degrees) {
    const snapshot = this.captureSelectedUVs();
    if (!snapshot.length) return false;
    const center = snapshot.reduce((sum, item) => sum.add(item.uv), new THREE.Vector2()).multiplyScalar(1 / snapshot.length);
    const angle = THREE.MathUtils.degToRad(degrees);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.applyCapturedTransform(snapshot, (uv) => {
      const x = uv.x - center.x;
      const y = uv.y - center.y;
      return new THREE.Vector2(center.x + x * cos - y * sin, center.y + x * sin + y * cos);
    });
    this.editor.commitHistory();
    this.status(`UV Rotate ${degrees}°`);
    return true;
  }

  scaleSelected(factor) {
    const snapshot = this.captureSelectedUVs();
    if (!snapshot.length || !Number.isFinite(factor)) return false;
    const center = snapshot.reduce((sum, item) => sum.add(item.uv), new THREE.Vector2()).multiplyScalar(1 / snapshot.length);
    this.applyCapturedTransform(snapshot, (uv) => uv.sub(center).multiplyScalar(factor).add(center));
    this.editor.commitHistory();
    this.status(`UV Scale ${factor}`);
    return true;
  }

  projectCube(record = true) {
    if (!this.mesh) return false;
    if (record) this.editor.checkpoint('Cube UV projection');
    const geometry = this.mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const box = new THREE.Box3().setFromBufferAttribute(position);
    const size = box.getSize(new THREE.Vector3());
    for (let i = 0; i < position.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i);
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const axis = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
      for (let k = 0; k < 3; k += 1) {
        const p = [a, b, c][k];
        let u; let v;
        if (axis === 'x') { u = (p.z - box.min.z) / (size.z || 1); v = (p.y - box.min.y) / (size.y || 1); }
        else if (axis === 'y') { u = (p.x - box.min.x) / (size.x || 1); v = (p.z - box.min.z) / (size.z || 1); }
        else { u = (p.x - box.min.x) / (size.x || 1); v = (p.y - box.min.y) / (size.y || 1); }
        uv.setXY(i + k, clamp01(u), clamp01(v));
      }
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.packIslands(false);
    this.render();
    this.status('Cube Projection');
    return true;
  }

  projectSphere() {
    if (!this.mesh) return false;
    this.editor.checkpoint('Sphere UV projection');
    const position = this.mesh.geometry.getAttribute('position');
    const uv = this.mesh.geometry.getAttribute('uv');
    const center = new THREE.Box3().setFromBufferAttribute(position).getCenter(new THREE.Vector3());
    for (let i = 0; i < position.count; i += 1) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i).sub(center).normalize();
      uv.setXY(i, 0.5 + Math.atan2(p.z, p.x) / (Math.PI * 2), 0.5 - Math.asin(p.y) / Math.PI);
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.render();
    this.status('Sphere Projection');
    return true;
  }

  projectCylinder() {
    if (!this.mesh) return false;
    this.editor.checkpoint('Cylinder UV projection');
    const position = this.mesh.geometry.getAttribute('position');
    const uv = this.mesh.geometry.getAttribute('uv');
    const box = new THREE.Box3().setFromBufferAttribute(position);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y || 1;
    for (let i = 0; i < position.count; i += 1) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i);
      const u = 0.5 + Math.atan2(p.z - center.z, p.x - center.x) / (Math.PI * 2);
      const v = (p.y - box.min.y) / height;
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.render();
    this.status('Cylinder Projection');
    return true;
  }

  projectFromView() {
    if (!this.mesh) return false;
    this.editor.checkpoint('Project from view');
    const position = this.mesh.geometry.getAttribute('position');
    const uv = this.mesh.geometry.getAttribute('uv');
    this.mesh.updateWorldMatrix(true, false);
    const camera = this.editor.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const values = [];
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      const world = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(this.mesh.matrixWorld);
      const x = world.dot(right); const y = world.dot(up);
      values.push([x, y]); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const sx = maxX - minX || 1; const sy = maxY - minY || 1;
    values.forEach(([x, y], i) => uv.setXY(i, (x - minX) / sx, (y - minY) / sy));
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.render();
    this.status('Project From View');
    return true;
  }

  unwrap() {
    if (!this.mesh) return false;
    this.editor.checkpoint('UV unwrap');
    const geometry = this.mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const components = this.geometryIslandsBySeams();
    for (const triangleIds of components) {
      const avg = new THREE.Vector3();
      triangleIds.forEach((id) => avg.add(this.triangles[id].normal));
      avg.normalize();
      const ref = Math.abs(avg.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const axisU = new THREE.Vector3().crossVectors(ref, avg).normalize();
      const axisV = new THREE.Vector3().crossVectors(avg, axisU).normalize();
      const corners = new Set();
      triangleIds.forEach((id) => this.triangles[id].corners.forEach((corner) => corners.add(corner)));
      const projected = new Map();
      let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
      for (const corner of corners) {
        const p = new THREE.Vector3().fromBufferAttribute(position, corner);
        const u = p.dot(axisU); const v = p.dot(axisV);
        projected.set(corner, [u, v]); minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }
      const su = maxU - minU || 1; const sv = maxV - minV || 1;
      for (const [corner, [u, v]] of projected) uv.setXY(corner, (u - minU) / su, (v - minV) / sv);
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.packIslands(false);
    this.render();
    this.status(`Unwrap · ${components.length} island(s)`);
    return true;
  }

  smartProject() {
    if (!this.mesh) return false;
    this.editor.checkpoint('Smart UV project');
    const uv = this.mesh.geometry.getAttribute('uv');
    const position = this.mesh.geometry.getAttribute('position');
    for (const triangle of this.triangles) {
      const n = triangle.normal;
      const axis = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
      triangle.corners.forEach((corner) => {
        const p = new THREE.Vector3().fromBufferAttribute(position, corner);
        if (axis === 'x') uv.setXY(corner, p.z, p.y);
        else if (axis === 'y') uv.setXY(corner, p.x, p.z);
        else uv.setXY(corner, p.x, p.y);
      });
    }
    uv.needsUpdate = true;
    this.normalizeAllUV();
    this.rebuildTopology();
    this.packIslands(false);
    this.render();
    this.status('Smart UV Project');
    return true;
  }

  normalizeAllUV() {
    const uv = this.mesh.geometry.getAttribute('uv');
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < uv.count; i += 1) {
      minX = Math.min(minX, uv.getX(i)); maxX = Math.max(maxX, uv.getX(i));
      minY = Math.min(minY, uv.getY(i)); maxY = Math.max(maxY, uv.getY(i));
    }
    const sx = maxX - minX || 1; const sy = maxY - minY || 1;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) - minX) / sx, (uv.getY(i) - minY) / sy);
    uv.needsUpdate = true;
  }

  geometryIslandsBySeams() {
    const edgeOwners = new Map();
    for (const triangle of this.triangles) {
      for (let e = 0; e < 3; e += 1) {
        const key = geometricEdgeKey(triangle.positions[e], triangle.positions[(e + 1) % 3]);
        if (!edgeOwners.has(key)) edgeOwners.set(key, []);
        edgeOwners.get(key).push(triangle.id);
      }
    }
    const adjacency = this.triangles.map(() => new Set());
    for (const [key, owners] of edgeOwners) {
      if (this.seams.has(key) || owners.length !== 2) continue;
      adjacency[owners[0]].add(owners[1]); adjacency[owners[1]].add(owners[0]);
    }
    const components = []; const visited = new Set();
    for (let start = 0; start < this.triangles.length; start += 1) {
      if (visited.has(start)) continue;
      const stack = [start]; const ids = []; visited.add(start);
      while (stack.length) {
        const id = stack.pop(); ids.push(id);
        for (const next of adjacency[id]) if (!visited.has(next)) { visited.add(next); stack.push(next); }
      }
      components.push(ids);
    }
    return components;
  }

  markSeamsFromEditMode(editMode) {
    if (!this.mesh || editMode?.mesh !== this.mesh || editMode.selectionMode !== 'edge' || !editMode.selectedEdges.size) {
      this.status('Mark Seam: в Edit Mode выделите рёбра этого Mesh');
      return false;
    }
    this.editor.checkpoint('Mark UV seam');
    for (const edge of editMode.edges) {
      if (!editMode.selectedEdges.has(edge.key)) continue;
      this.seams.add(geometricEdgeKey(editMode.vertices[edge.a].position, editMode.vertices[edge.b].position));
    }
    this.saveSeams();
    this.rebuildTopology();
    this.render();
    this.status(`Mark Seam · всего ${this.seams.size}`);
    return true;
  }

  clearSeams() {
    if (!this.mesh || !this.seams.size) return false;
    this.editor.checkpoint('Clear UV seams');
    this.seams.clear();
    this.saveSeams();
    this.rebuildTopology();
    this.render();
    this.status('Все UV seams очищены');
    return true;
  }

  packIslands(record = true) {
    if (!this.mesh) return false;
    if (record) this.editor.checkpoint('Pack UV islands');
    this.rebuildTopology();
    const uv = this.mesh.geometry.getAttribute('uv');
    const count = this.islands.length;
    if (!count) return false;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const margin = 0.03;
    const cellW = 1 / cols; const cellH = 1 / rows;
    for (let i = 0; i < count; i += 1) {
      const island = this.islands[i];
      const points = [...island.corners].map((id) => new THREE.Vector2().fromBufferAttribute(uv, id));
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      points.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      const sx = maxX - minX || 1; const sy = maxY - minY || 1;
      const scale = Math.min((cellW - margin * 2) / sx, (cellH - margin * 2) / sy);
      const col = i % cols; const row = Math.floor(i / cols);
      for (const corner of island.corners) {
        const x = (uv.getX(corner) - minX) * scale + col * cellW + margin;
        const y = (uv.getY(corner) - minY) * scale + (rows - 1 - row) * cellH + margin;
        uv.setXY(corner, x, y);
      }
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.render();
    this.status(`Pack Islands · ${count}`);
    return true;
  }

  averageIslandScale() {
    if (!this.mesh || !this.islands.length) return false;
    this.editor.checkpoint('Average island scale');
    const uv = this.mesh.geometry.getAttribute('uv');
    const metrics = this.islands.map((island) => {
      let area3 = 0; let area2 = 0;
      island.triangles.forEach((id) => {
        const t = this.triangles[id];
        area3 += triangleArea3D(...t.positions);
        area2 += triangleArea2D(...t.uvs);
      });
      return { island, density: area3 > EPS && area2 > EPS ? Math.sqrt(area2 / area3) : 1 };
    });
    const target = metrics.reduce((sum, item) => sum + item.density, 0) / metrics.length;
    for (const { island, density } of metrics) {
      const ids = [...island.corners];
      const center = ids.reduce((sum, id) => sum.add(new THREE.Vector2().fromBufferAttribute(uv, id)), new THREE.Vector2()).multiplyScalar(1 / ids.length);
      const scale = density > EPS ? target / density : 1;
      ids.forEach((id) => {
        const p = new THREE.Vector2().fromBufferAttribute(uv, id).sub(center).multiplyScalar(scale).add(center);
        uv.setXY(id, p.x, p.y);
      });
    }
    uv.needsUpdate = true;
    this.rebuildTopology();
    this.render();
    this.status('Average Island Scale');
    return true;
  }

  fit() {
    this.zoom = 1;
    this.pan.set(0, 0);
    this.render();
  }

  loadTexture(file) {
    if (!file) { this.textureImage = null; this.render(); return; }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      this.textureImage = image;
      URL.revokeObjectURL(url);
      this.render();
      this.status(`UV reference: ${file.name}`);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  updateInfo() {
    if (!this.elements.info) return;
    this.elements.info.textContent = this.mesh
      ? `${this.mode} · selected ${this.selected.size} · ${this.islands.length} islands · ${this.seams.size} seams`
      : 'No mesh';
  }
}
