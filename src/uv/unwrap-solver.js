import * as THREE from 'three';

const EPS = 1e-8;
const POSITION_EPS = 1e-5;

function positionKey(v) {
  return `${Math.round(v.x / POSITION_EPS)}:${Math.round(v.y / POSITION_EPS)}:${Math.round(v.z / POSITION_EPS)}`;
}

function undirectedKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildLogicalIsland(controller, triangleIds) {
  const vertices = new Map();
  const triangles = [];

  for (const triangleId of triangleIds) {
    const triangle = controller.triangles[triangleId];
    if (!triangle) continue;
    const keys = triangle.positions.map((position, cornerIndex) => {
      const key = positionKey(position);
      if (!vertices.has(key)) {
        vertices.set(key, {
          key,
          position: position.clone(),
          corners: new Set(),
          neighbors: new Map(),
        });
      }
      vertices.get(key).corners.add(triangle.corners[cornerIndex]);
      return key;
    });
    if (new Set(keys).size !== 3) continue;
    triangles.push({ keys, positions: triangle.positions.map((p) => p.clone()) });
  }

  const edgeCounts = new Map();
  const edgeLengths = new Map();
  const edgeWeights = new Map();

  const addWeight = (a, b, value) => {
    const key = undirectedKey(a, b);
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + Math.max(1e-6, Math.abs(value)));
  };

  const cotangent = (u, v) => {
    const cross = new THREE.Vector3().crossVectors(u, v).length();
    if (cross <= EPS) return 0;
    return u.dot(v) / cross;
  };

  for (const triangle of triangles) {
    const [a, b, c] = triangle.keys;
    const [pa, pb, pc] = triangle.positions;
    const edges = [
      [a, b, pa.distanceTo(pb)],
      [b, c, pb.distanceTo(pc)],
      [c, a, pc.distanceTo(pa)],
    ];
    for (const [u, v, length] of edges) {
      const key = undirectedKey(u, v);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      edgeLengths.set(key, Math.max(edgeLengths.get(key) ?? 0, length));
    }

    const cotA = cotangent(pb.clone().sub(pa), pc.clone().sub(pa));
    const cotB = cotangent(pc.clone().sub(pb), pa.clone().sub(pb));
    const cotC = cotangent(pa.clone().sub(pc), pb.clone().sub(pc));
    addWeight(b, c, cotA);
    addWeight(c, a, cotB);
    addWeight(a, b, cotC);
  }

  for (const [edge, weight] of edgeWeights) {
    const [a, b] = edge.split('|');
    vertices.get(a)?.neighbors.set(b, weight);
    vertices.get(b)?.neighbors.set(a, weight);
  }

  const boundaryEdges = [...edgeCounts.entries()]
    .filter(([, count]) => count === 1)
    .map(([key]) => {
      const [a, b] = key.split('|');
      return { a, b, key, length: edgeLengths.get(key) ?? 1 };
    });

  return { vertices, triangles, boundaryEdges, edgeLengths };
}

function boundaryLoops(boundaryEdges) {
  const adjacency = new Map();
  for (const edge of boundaryEdges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }

  const edgeSet = new Set(boundaryEdges.map((edge) => edge.key));
  const visited = new Set();
  const loops = [];

  for (const edge of boundaryEdges) {
    if (visited.has(edge.key)) continue;
    const loop = [edge.a];
    let previous = null;
    let current = edge.a;
    let guard = 0;

    while (guard < boundaryEdges.length + 5) {
      const candidates = adjacency.get(current) ?? [];
      let next = candidates.find((candidate) => {
        if (candidate === previous && candidates.length > 1) return false;
        return !visited.has(undirectedKey(current, candidate));
      });
      if (!next && candidates.includes(loop[0]) && current !== loop[0]) next = loop[0];
      if (!next) break;
      const key = undirectedKey(current, next);
      visited.add(key);
      previous = current;
      current = next;
      if (current === loop[0]) break;
      loop.push(current);
      guard += 1;
    }
    if (loop.length >= 3 && current === loop[0]) loops.push(loop);
  }
  return loops;
}

function loopPerimeter(loop, edgeLengths) {
  let length = 0;
  for (let i = 0; i < loop.length; i += 1) {
    length += edgeLengths.get(undirectedKey(loop[i], loop[(i + 1) % loop.length])) ?? 1;
  }
  return length;
}

function mapBoundaryLoop(loop, edgeLengths, uvMap, radius, reverse = false) {
  const lengths = [];
  let perimeter = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const length = edgeLengths.get(undirectedKey(loop[i], loop[(i + 1) % loop.length])) ?? 1;
    lengths.push(length);
    perimeter += length;
  }
  let traveled = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const t = perimeter > EPS ? traveled / perimeter : i / loop.length;
    const angle = (reverse ? -1 : 1) * t * Math.PI * 2;
    uvMap.set(loop[i], new THREE.Vector2(
      0.5 + Math.cos(angle) * radius,
      0.5 + Math.sin(angle) * radius,
    ));
    traveled += lengths[i];
  }
}

function initializeInterior(logical, boundarySet, uvMap) {
  const boundaryValues = [...boundarySet].map((key) => uvMap.get(key)).filter(Boolean);
  const center = boundaryValues.length
    ? boundaryValues.reduce((sum, value) => sum.add(value), new THREE.Vector2()).multiplyScalar(1 / boundaryValues.length)
    : new THREE.Vector2(0.5, 0.5);
  for (const key of logical.vertices.keys()) if (!uvMap.has(key)) uvMap.set(key, center.clone());
}

function solveHarmonic(logical, uvMap, boundarySet, iterations) {
  const interior = [...logical.vertices.values()].filter((vertex) => !boundarySet.has(vertex.key));
  if (!interior.length) return;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Map();
    for (const vertex of interior) {
      let sumWeight = 0;
      const average = new THREE.Vector2();
      for (const [neighborKey, weightRaw] of vertex.neighbors) {
        const neighbor = uvMap.get(neighborKey);
        if (!neighbor) continue;
        const weight = Math.max(1e-6, weightRaw);
        average.addScaledVector(neighbor, weight);
        sumWeight += weight;
      }
      next.set(vertex.key, sumWeight > EPS ? average.multiplyScalar(1 / sumWeight) : uvMap.get(vertex.key).clone());
    }
    let maxDelta = 0;
    for (const [key, value] of next) {
      maxDelta = Math.max(maxDelta, value.distanceTo(uvMap.get(key)));
      uvMap.set(key, value);
    }
    if (maxDelta < 1e-7) break;
  }
}

function writeUV(logical, uvMap, uvAttribute) {
  for (const vertex of logical.vertices.values()) {
    const uv = uvMap.get(vertex.key);
    if (!uv) continue;
    for (const corner of vertex.corners) uvAttribute.setXY(corner, uv.x, uv.y);
  }
}

export function harmonicUnwrap(controller, {
  iterations = 120,
  record = true,
  pack = true,
} = {}) {
  if (!controller?.mesh) return { islands: 0, solved: 0, skipped: 0 };
  controller.rebuildTopology();
  const components = controller.geometryIslandsBySeams();
  if (!components.length) return { islands: 0, solved: 0, skipped: 0 };
  if (record) controller.editor.checkpoint('Harmonic UV unwrap');

  const uvAttribute = controller.mesh.geometry.getAttribute('uv');
  let solved = 0;
  let skipped = 0;
  const maxIterations = Math.max(10, Math.min(1000, Math.floor(Number(iterations) || 120)));

  for (const triangleIds of components) {
    const logical = buildLogicalIsland(controller, triangleIds);
    const loops = boundaryLoops(logical.boundaryEdges)
      .map((loop) => ({ loop, perimeter: loopPerimeter(loop, logical.edgeLengths) }))
      .sort((a, b) => b.perimeter - a.perimeter);
    if (!loops.length) {
      skipped += 1;
      continue;
    }

    const uvMap = new Map();
    const boundarySet = new Set();
    const outerPerimeter = loops[0].perimeter || 1;
    loops.forEach(({ loop, perimeter }, index) => {
      const radius = index === 0
        ? 0.48
        : Math.max(0.04, Math.min(0.34, 0.32 * Math.sqrt(perimeter / outerPerimeter)));
      mapBoundaryLoop(loop, logical.edgeLengths, uvMap, radius, index > 0);
      loop.forEach((key) => boundarySet.add(key));
    });

    initializeInterior(logical, boundarySet, uvMap);
    solveHarmonic(logical, uvMap, boundarySet, maxIterations);
    writeUV(logical, uvMap, uvAttribute);
    solved += 1;
  }

  uvAttribute.needsUpdate = true;
  controller.rebuildTopology();
  if (pack && controller.packIslands) controller.packIslands(false);
  controller.render();
  controller.status(`Harmonic Unwrap · solved ${solved}/${components.length}${skipped ? ` · skipped ${skipped} closed island(s)` : ''}`);
  return { islands: components.length, solved, skipped, iterations: maxIterations };
}

export function installHarmonicUnwrap({ controller, workspace }) {
  if (!controller || !workspace || controller.__harmonicUnwrap) return controller?.__harmonicUnwrap ?? null;
  const unwrapSection = [...workspace.querySelectorAll('.uv-tools-section')]
    .find((section) => section.querySelector('h3')?.textContent.trim() === 'Unwrap');
  if (!unwrapSection) return null;

  const panel = document.createElement('div');
  panel.className = 'uv-harmonic-tools';
  panel.innerHTML = `
    <label><span>Solver iterations</span><input type="number" min="10" max="1000" step="10" value="120" data-uv-harmonic-iterations></label>
    <button type="button" data-uv-harmonic-run>Harmonic Unwrap</button>`;
  unwrapSection.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .uv-harmonic-tools{display:grid;grid-template-columns:minmax(0,1fr) 1fr;gap:5px;align-items:end;margin-top:6px}.uv-harmonic-tools label{display:grid;gap:3px;font-size:10px;color:#aaa}.uv-harmonic-tools input{height:24px;min-width:0;background:#1f1f1f;color:#ddd;border:1px solid #484848;border-radius:3px;padding:2px 4px}.uv-harmonic-tools button{min-height:25px;background:#343434;color:#ddd;border:1px solid #4a4a4a;border-radius:3px;font-size:10px}.uv-harmonic-tools button:hover{background:#484848}`;
  document.head.appendChild(style);

  const iterationsInput = panel.querySelector('[data-uv-harmonic-iterations]');
  panel.querySelector('[data-uv-harmonic-run]').addEventListener('click', () => harmonicUnwrap(controller, {
    iterations: Number(iterationsInput.value) || 120,
  }));

  const api = {
    unwrap: (options = {}) => harmonicUnwrap(controller, options),
    panel,
  };
  controller.__harmonicUnwrap = api;
  return api;
}
