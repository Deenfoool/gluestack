function faceMaterialIndex(editMode, group) {
  const triangleIndex = group?.triangles?.[0];
  return triangleIndex === undefined ? null : editMode.triangles[triangleIndex]?.materialIndex ?? 0;
}

function boundaryKeys(group) {
  return (group?.boundary ?? []).map((edge) => edge.key);
}

function oppositeEdge(group, edgeKey) {
  const boundary = group?.boundary ?? [];
  if (boundary.length !== 4) return null;
  const current = boundary.find((edge) => edge.key === edgeKey);
  if (!current) return null;
  return boundary.find((edge) => (
    edge.key !== current.key
    && edge.a !== current.a
    && edge.a !== current.b
    && edge.b !== current.a
    && edge.b !== current.b
  )) ?? null;
}

function edgeToGroups(editMode) {
  const map = new Map();
  for (const group of editMode.faceGroups) {
    for (const key of boundaryKeys(group)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(group);
    }
  }
  return map;
}

function collectRing(editMode, seedKey) {
  const byEdge = edgeToGroups(editMode);
  const selected = new Set([seedKey]);
  const queue = [{ edgeKey: seedKey, fromGroup: null }];
  const visitedSteps = new Set();

  while (queue.length) {
    const step = queue.shift();
    const groups = byEdge.get(step.edgeKey) ?? [];
    for (const group of groups) {
      if (step.fromGroup === group.id) continue;
      const stepKey = `${step.edgeKey}|${group.id}`;
      if (visitedSteps.has(stepKey)) continue;
      visitedSteps.add(stepKey);
      const opposite = oppositeEdge(group, step.edgeKey);
      if (!opposite) continue;
      selected.add(opposite.key);
      queue.push({ edgeKey: opposite.key, fromGroup: group.id });
    }
  }
  return selected;
}

function selectEdgeRing(editMode) {
  if (!editMode.active || editMode.selectionMode !== 'edge') {
    editMode.status('Edge Ring: переключитесь в Edge Select');
    return false;
  }
  if (!editMode.selectedEdges.size) {
    editMode.status('Edge Ring: сначала выберите ребро');
    return false;
  }

  const result = new Set();
  for (const seed of editMode.selectedEdges) collectRing(editMode, seed).forEach((key) => result.add(key));
  if (result.size === editMode.selectedEdges.size && [...result].every((key) => editMode.selectedEdges.has(key))) {
    editMode.status('Edge Ring: для выбранного ребра нет однозначной quad-ring цепочки');
    return false;
  }

  editMode.selectedEdges.clear();
  result.forEach((key) => editMode.selectedEdges.add(key));
  editMode.refreshOverlay();
  editMode.updatePivot();
  editMode.emitChange();
  editMode.status(`Edge Ring · ${result.size} edge(s)`);
  return true;
}

function selectByMaterial(editMode) {
  if (!editMode.active || editMode.selectionMode !== 'face') {
    editMode.status('Select by Material: переключитесь в Face Select');
    return false;
  }
  const seedId = editMode.selectedFaces.values().next().value;
  if (seedId === undefined) {
    editMode.status('Select by Material: сначала выберите грань');
    return false;
  }
  const materialIndex = faceMaterialIndex(editMode, editMode.faceGroups[seedId]);
  if (materialIndex === null) return false;

  editMode.selectedFaces.clear();
  for (const group of editMode.faceGroups) {
    if (faceMaterialIndex(editMode, group) === materialIndex) editMode.selectedFaces.add(group.id);
  }
  editMode.refreshOverlay();
  editMode.updatePivot();
  editMode.emitChange();
  editMode.status(`Select by Material · slot ${materialIndex} · ${editMode.selectedFaces.size} face(s)`);
  return true;
}

export function installAdvancedEditSelection({ editMode }) {
  if (!editMode || editMode.advancedSelection) return editMode?.advancedSelection ?? null;
  const api = {
    selectEdgeRing: () => selectEdgeRing(editMode),
    selectByMaterial: () => selectByMaterial(editMode),
  };
  editMode.advancedSelection = api;
  return api;
}
