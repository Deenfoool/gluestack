import * as THREE from 'three';

const EPS = 1e-10;
const POSITION_EPS = 1e-5;

function positionKey(position, index) {
  return `${Math.round(position.getX(index) / POSITION_EPS)}:${Math.round(position.getY(index) / POSITION_EPS)}:${Math.round(position.getZ(index) / POSITION_EPS)}`;
}

function triangleIndices(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index?.count ?? position?.count ?? 0;
  const triangles = [];
  for (let i = 0; i + 2 < count; i += 3) {
    triangles.push(index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2]);
  }
  return triangles;
}

function topologyStats(geometry) {
  const position = geometry?.getAttribute('position');
  if (!position) return null;
  const keyByIndex = Array.from({ length: position.count }, (_, index) => positionKey(position, index));
  const edges = new Map();
  let degenerateFaces = 0;
  let invalidFaces = 0;
  let inconsistentWinding = 0;

  for (const triangle of triangleIndices(geometry)) {
    const [ia, ib, ic] = triangle;
    const pa = new THREE.Vector3().fromBufferAttribute(position, ia);
    const pb = new THREE.Vector3().fromBufferAttribute(position, ib);
    const pc = new THREE.Vector3().fromBufferAttribute(position, ic);
    if (![pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z].every(Number.isFinite)) {
      invalidFaces += 1;
      continue;
    }
    const area2 = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa)).lengthSq();
    if (area2 <= EPS) degenerateFaces += 1;

    const keys = [keyByIndex[ia], keyByIndex[ib], keyByIndex[ic]];
    for (let edge = 0; edge < 3; edge += 1) {
      const from = keys[edge];
      const to = keys[(edge + 1) % 3];
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ from, to });
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const owners of edges.values()) {
    if (owners.length === 1) openEdges += 1;
    else if (owners.length > 2) nonManifoldEdges += 1;
    else if (owners.length === 2 && owners[0].from === owners[1].from && owners[0].to === owners[1].to) inconsistentWinding += 1;
  }

  const uniquePositions = new Set(keyByIndex).size;
  return {
    triangles: triangleIndices(geometry).length,
    openEdges,
    nonManifoldEdges,
    inconsistentWinding,
    degenerateFaces,
    invalidFaces,
    duplicatePositionVertices: Math.max(0, position.count - uniquePositions),
    duplicatePositionRatio: position.count ? Math.max(0, position.count - uniquePositions) / position.count : 0,
  };
}

function materialSlots(mesh) {
  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : mesh.material ? [mesh.material] : [];
}

function materialGroupStats(mesh) {
  const slots = materialSlots(mesh);
  const groups = mesh.geometry?.groups ?? [];
  const used = new Set(groups.map((group) => group.materialIndex ?? 0));
  if (!groups.length && slots.length) used.add(0);
  const invalid = [...used].filter((index) => index < 0 || index >= slots.length);
  const unused = slots.map((_, index) => index).filter((index) => !used.has(index));
  return { slots: slots.length, groups: groups.length, used, invalid, unused };
}

function hasNormalMap(mesh) {
  return materialSlots(mesh).some((material) => Boolean(material?.normalMap));
}

function advancedIssues(editor) {
  const issues = [];
  editor.modelRoot.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const name = object.name || 'Mesh';
    const topology = topologyStats(object.geometry);
    if (topology) {
      if (topology.degenerateFaces) issues.push({ level: 'error', object: name, message: `Degenerate faces: ${topology.degenerateFaces}` });
      if (topology.invalidFaces) issues.push({ level: 'error', object: name, message: `Invalid/NaN faces: ${topology.invalidFaces}` });
      if (topology.nonManifoldEdges) issues.push({ level: 'error', object: name, message: `Non-manifold edges: ${topology.nonManifoldEdges}` });
      if (topology.inconsistentWinding) issues.push({ level: 'warning', object: name, message: `Inconsistent winding across ${topology.inconsistentWinding} shared edge(s)` });
      if (topology.openEdges) issues.push({ level: 'warning', object: name, message: `Open boundary edges: ${topology.openEdges}` });
      if (topology.duplicatePositionRatio > 0.15) {
        issues.push({ level: 'warning', object: name, message: `Many duplicated position vertices: ${topology.duplicatePositionVertices} (${Math.round(topology.duplicatePositionRatio * 100)}%) — may be intentional UV/hard-edge splits` });
      }
    }

    object.updateWorldMatrix(true, false);
    const determinant = object.matrixWorld.determinant();
    if (determinant < -EPS) issues.push({ level: 'warning', object: name, message: 'Mirrored/negative world scale: winding may flip after transform bake/export' });

    const groups = materialGroupStats(object);
    if (groups.invalid.length) issues.push({ level: 'error', object: name, message: `Geometry group references missing material slot(s): ${groups.invalid.join(', ')}` });
    if (groups.unused.length) issues.push({ level: 'warning', object: name, message: `Unused material slot(s): ${groups.unused.join(', ')}` });
    if (groups.slots > 1 && !groups.groups) issues.push({ level: 'warning', object: name, message: 'Multiple material slots but geometry has no groups; only slot 0 is used' });

    if (hasNormalMap(object)) {
      const geometry = object.geometry;
      const uv = geometry.getAttribute('uv');
      const normal = geometry.getAttribute('normal');
      const tangent = geometry.getAttribute('tangent');
      if (!uv) issues.push({ level: 'error', object: name, message: 'Normal mapped material without UV0' });
      if (!normal) issues.push({ level: 'error', object: name, message: 'Normal mapped material without normals' });
      if (!tangent) issues.push({ level: 'warning', object: name, message: 'Normal map present but tangents are not stored; verify target runtime tangent policy' });
    }
  });
  return issues;
}

function sceneSnapshot(controller) {
  const data = controller.analyze();
  return {
    meshes: data.meshes,
    vertices: data.vertices,
    triangles: data.triangles,
    materials: data.materialCount,
    textures: data.textureCount,
    textureMB: data.textureMB,
    issues: data.issues.length,
    errors: data.issues.filter((issue) => issue.level === 'error').length,
  };
}

export function installGameReadyValidatorV2({ editor, gameReady }) {
  const controller = gameReady?.controller;
  if (!editor || !controller || controller.__validatorV2) return controller?.__validatorV2 ?? null;

  const originalAnalyze = controller.analyze.bind(controller);
  controller.analyze = () => {
    const data = originalAnalyze();
    data.issues.push(...advancedIssues(editor));
    data.advanced = {
      errors: data.issues.filter((issue) => issue.level === 'error').length,
      warnings: data.issues.filter((issue) => issue.level === 'warning').length,
    };
    return data;
  };

  const originalOptimize = controller.optimize.bind(controller);
  controller.optimize = () => {
    const before = sceneSnapshot(controller);
    const ok = originalOptimize();
    const after = sceneSnapshot(controller);
    controller.lastOptimizationReport = {
      before,
      after,
      delta: {
        vertices: after.vertices - before.vertices,
        triangles: after.triangles - before.triangles,
        materials: after.materials - before.materials,
        textures: after.textures - before.textures,
        issues: after.issues - before.issues,
      },
    };
    window.dispatchEvent(new CustomEvent('gluestack:optimization-report', { detail: controller.lastOptimizationReport }));
    return ok;
  };

  const panel = gameReady.panel;
  if (panel && !panel.querySelector('[data-gr-validation-v2]')) {
    const card = document.createElement('div');
    card.className = 'game-ready-card';
    card.dataset.grValidationV2 = '';
    card.innerHTML = `
      <div class="game-ready-title"><i data-lucide="shield-check"></i><span>Production Validation</span></div>
      <div class="game-ready-note">Checks manifold edges, degenerate faces, winding, mirrored transforms, material groups/slots and normal-map prerequisites.</div>
      <div class="game-ready-report" data-gr-v2-report>No optimization report yet.</div>`;
    panel.appendChild(card);
    const style = document.createElement('style');
    style.textContent = `.game-ready-report{margin-top:7px;padding:6px;background:#222;border-radius:3px;color:#aaa;font-size:10px;line-height:1.4;white-space:pre-line}`;
    document.head.appendChild(style);
    const output = card.querySelector('[data-gr-v2-report]');
    window.addEventListener('gluestack:optimization-report', (event) => {
      const report = event.detail;
      if (!report) return;
      output.textContent = `Optimize before → after\nVertices ${report.before.vertices.toLocaleString()} → ${report.after.vertices.toLocaleString()}\nTriangles ${report.before.triangles.toLocaleString()} → ${report.after.triangles.toLocaleString()}\nMaterials ${report.before.materials} → ${report.after.materials}\nIssues ${report.before.issues} → ${report.after.issues}`;
    });
  }

  const api = {
    analyzeTopology: (geometry) => topologyStats(geometry),
    analyzeIssues: () => advancedIssues(editor),
    get lastReport() { return controller.lastOptimizationReport ?? null; },
  };
  controller.__validatorV2 = api;
  return api;
}
