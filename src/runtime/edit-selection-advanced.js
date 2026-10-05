import { componentVisible } from '../edit/component-visibility.js';
function selectionTopology(editMode) {
  const edges = new Map(editMode.logicalEdges.filter(edge => componentVisible(editMode,'edge',edge.key)).map(edge => [edge.key, edge]));
  const byEdge = new Map();
  const byVertex = new Map();
  const quads = new Set();
  for (const edge of edges.values()) {
    for (const vertex of [edge.a, edge.b]) {
      if (!byVertex.has(vertex)) byVertex.set(vertex, []);
      byVertex.get(vertex).push(edge);
    }
  }
  for (const group of editMode.faceGroups) {
    if (!componentVisible(editMode,'face',group.id)) continue;
    const boundary = group.boundary ?? [];
    const degree = new Map();
    const keys = new Set();
    for (const edge of boundary) {
      if (!byEdge.has(edge.key)) byEdge.set(edge.key, []);
      byEdge.get(edge.key).push(group);
      keys.add(edge.key);
      for (const vertex of [edge.a, edge.b]) degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
    }
    if (boundary.length === 4 && keys.size === 4 && degree.size === 4
      && [...degree.values()].every(value => value === 2)
      && boundary.every(edge => edge.a !== edge.b && edges.has(edge.key))) quads.add(group);
  }
  return { edges, byEdge, byVertex, quads };
}

function manifoldFan(topology, incident) {
  const neighbors = new Map();
  for (const edge of incident) {
    const groups = topology.byEdge.get(edge.key) ?? [];
    if (!groups.length || groups.length > 2 || groups.some(group => !topology.quads.has(group))) return false;
    for (const group of groups) {
      if (!neighbors.has(group)) neighbors.set(group, new Set());
      groups.forEach(next => neighbors.get(group).add(next));
    }
  }
  // Reject disconnected surface fans touching at a single vertex.
  if (!neighbors.size) return false;
  const first = neighbors.keys().next().value;
  const visited = new Set([first]);
  const queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of neighbors.get(queue[cursor])) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited.size === neighbors.size;
}

function loopContinuation(topology, edge, vertex) {
  const incident = topology.byVertex.get(vertex) ?? [];
  const groups = topology.byEdge.get(edge.key) ?? [];
  if (groups.length !== 1 && (groups.length !== 2 || incident.length !== 4)) return null;
  if (!manifoldFan(topology, incident)) return null;
  if (groups.length === 1) {
    const boundary = incident.filter(candidate => topology.byEdge.get(candidate.key)?.length === 1);
    return boundary.length === 2 ? boundary.find(candidate => candidate.key !== edge.key) : null;
  }
  // A regular quad vertex has four incident edges. The opposite edge
  // shares the vertex but neither of the incoming edge's faces.
  if (groups.length !== 2 || incident.length !== 4) return null;
  if (incident.some(candidate => topology.byEdge.get(candidate.key)?.length !== 2)) return null;
  const candidates = incident.filter(candidate => candidate.key !== edge.key
    && !topology.byEdge.get(candidate.key).some(group => groups.includes(group)));
  return candidates.length === 1 ? candidates[0] : null;
}

function collectLoops(topology, seeds) {
  const selected = new Set(seeds);
  const queue = [];
  for (const key of seeds) {
    const edge = topology.edges.get(key);
    queue.push({ edge, vertex: edge.a }, { edge, vertex: edge.b });
  }
  const visited = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { edge, vertex } = queue[cursor];
    const step = `${edge.key}|${vertex}`;
    if (visited.has(step)) continue;
    visited.add(step);
    const next = loopContinuation(topology, edge, vertex);
    if (!next) continue;
    selected.add(next.key);
    queue.push({ edge: next, vertex: next.a === vertex ? next.b : next.a });
  }
  return selected;
}

function collectRings(topology, seeds) {
  const selected = new Set(seeds);
  const queue = [...seeds];
  const visited = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor];
    if (visited.has(key)) continue;
    visited.add(key);
    const groups = topology.byEdge.get(key) ?? [];
    if (groups.length > 2) continue;
    const current = topology.edges.get(key);
    for (const group of groups) {
      if (!topology.quads.has(group)) continue;
      const opposite = group.boundary.find(edge => edge.a !== current.a && edge.a !== current.b
        && edge.b !== current.a && edge.b !== current.b);
      if (!opposite || topology.byEdge.get(opposite.key)?.length > 2) continue;
      selected.add(opposite.key);
      queue.push(opposite.key);
    }
  }
  return selected;
}

function selectEdgeChain(editMode, kind) {
  const label = kind === 'loop' ? 'Edge Loop' : 'Edge Ring';
  if (!editMode.active || editMode.selectionMode !== 'edge') {
    editMode.status(`${label}: переключитесь в Edge Select`);
    return false;
  }
  if (!editMode.selectedEdges.size) {
    editMode.status(`${label}: сначала выберите ребро`);
    return false;
  }
  const topology = selectionTopology(editMode);
  if ([...editMode.selectedEdges].some(key => !topology.edges.has(key))) {
    editMode.status(`${label}: выделение содержит устаревшее или внутреннее ребро`);
    return false;
  }
  const result = kind === 'loop' ? collectLoops(topology, editMode.selectedEdges) : collectRings(topology, editMode.selectedEdges);
  if (result.size === editMode.selectedEdges.size) {
    editMode.status(`${label}: нет однозначного продолжения по quad-топологии`);
    return false;
  }
  editMode.selectedEdges.clear();
  result.forEach(key => editMode.selectedEdges.add(key));
  refreshSelection(editMode);
  editMode.status(`${label} · ${result.size} edge(s)`);
  return true;
}

function refreshSelection(editMode) {
  editMode.refreshOverlay();
  editMode.updatePivot();
  editMode.emitChange();
}

function materialSlots(editMode, group) {
  return new Set((group?.triangles ?? []).map(index => editMode.triangles[index]?.materialIndex ?? 0));
}

function selectByMaterial(editMode) {
  if (!editMode.active || editMode.selectionMode !== 'face') {
    editMode.status('Select by Material: переключитесь в Face Select');
    return false;
  }
  const seeds = editMode.faceGroups.filter(group => componentVisible(editMode,'face',group.id) && editMode.selectedFaces.has(group.id));
  if (!seeds.length) {
    editMode.status('Select by Material: сначала выберите грань');
    return false;
  }
  const slots = new Set();
  for (const group of seeds) materialSlots(editMode, group).forEach(slot => slots.add(slot));
  editMode.selectedFaces.clear();
  for (const group of editMode.faceGroups) {
    if (!componentVisible(editMode,'face',group.id)) continue;
    if ([...materialSlots(editMode, group)].some(slot => slots.has(slot))) editMode.selectedFaces.add(group.id);
  }
  refreshSelection(editMode);
  editMode.status(`Select by Material · slots ${[...slots].join(', ')} · ${editMode.selectedFaces.size} face(s)`);
  return true;
}

export function installAdvancedEditSelection({ editMode }) {
  if (!editMode || editMode.advancedSelection) return editMode?.advancedSelection ?? null;
  const api = {
    selectEdgeLoop: () => selectEdgeChain(editMode, 'loop'),
    selectEdgeRing: () => selectEdgeChain(editMode, 'ring'),
    selectByMaterial: () => selectByMaterial(editMode),
  };
  editMode.advancedSelection = api;
  return api;
}
