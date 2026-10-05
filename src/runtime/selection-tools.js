import { componentVisible } from '../edit/component-visibility.js';
import { selectableObjects } from './selection-geometry.js';

function refreshEdit(editMode) {
  editMode.refreshOverlay();
  editMode.updatePivot();
  editMode.emitChange();
}

function editUniverse(editMode) {
  if (editMode.selectionMode === 'vertex') return editMode.vertices.map((_, index) => index);
  if (editMode.selectionMode === 'edge') return editMode.logicalEdges.map((edge) => edge.key);
  return editMode.faceGroups.map((group) => group.id);
}

function invertEditSelection(editMode) {
  if (!editMode.active) return false;
  const selected = editMode.currentSelectionSet();
  const inverted = new Set();
  for (const key of editUniverse(editMode)) if (componentVisible(editMode,editMode.selectionMode,key) && !selected.has(key)) inverted.add(key);
  selected.clear();
  inverted.forEach((key) => selected.add(key));
  refreshEdit(editMode);
  editMode.status(`Invert Select · ${selected.size} ${editMode.selectionMode}(s)`);
  return true;
}

function selectedSeedVertices(editMode) {
  return editMode.getSelectedVertexIds();
}

function connectedVertices(editMode, seeds) {
  const adjacency = new Map();
  for (let index = 0; index < editMode.vertices.length; index += 1) adjacency.set(index, new Set());
  for (const edge of editMode.edges) {
    if (!componentVisible(editMode,'vertex',edge.a) || !componentVisible(editMode,'vertex',edge.b)
      || !componentVisible(editMode,'edge',edge.key)) continue;
    if (edge.triangles?.length && !edge.triangles.some(id => componentVisible(editMode,'face',editMode.triangleToFaceGroup[id]))) continue;
    adjacency.get(edge.a)?.add(edge.b);
    adjacency.get(edge.b)?.add(edge.a);
  }

  const visited = new Set(seeds);
  const queue = [...seeds];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const vertex = queue[cursor];
    for (const next of adjacency.get(vertex) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function selectLinked(editMode) {
  if (!editMode.active) return false;
  const seeds = selectedSeedVertices(editMode);
  if (!seeds.size) {
    editMode.status('Select Linked: сначала выберите компонент');
    return false;
  }
  const linked = connectedVertices(editMode, seeds);
  const target = editMode.currentSelectionSet();
  target.clear();

  if (editMode.selectionMode === 'vertex') {
    linked.forEach((vertex) => { if (componentVisible(editMode,'vertex',vertex)) target.add(vertex); });
  } else if (editMode.selectionMode === 'edge') {
    for (const edge of editMode.logicalEdges) {
      if (componentVisible(editMode,'edge',edge.key) && linked.has(edge.a) && linked.has(edge.b)) target.add(edge.key);
    }
  } else {
    for (const group of editMode.faceGroups) {
      if (!componentVisible(editMode,'face',group.id)) continue;
      const groupVertices = new Set();
      for (const triangleIndex of group.triangles ?? []) {
        for (const vertex of editMode.triangles[triangleIndex]?.v ?? []) groupVertices.add(vertex);
      }
      if ([...groupVertices].some((vertex) => linked.has(vertex))) target.add(group.id);
    }
  }

  refreshEdit(editMode);
  editMode.status(`Select Linked · ${target.size} ${editMode.selectionMode}(s)`);
  return true;
}

export function installSelectionTools({ editor, editMode }) {
  if (!editor || !editMode || editor.selectionTools) return editor?.selectionTools ?? null;

  function objectSelectAll() {
    const objects = selectableObjects(editor);
    if (!objects.length) {
      editor.clearSelection();
      editor.events.onStatus('Select All: сцена пуста');
      return false;
    }
    editor.selectMany(objects, editor.selected && objects.includes(editor.selected) ? editor.selected : objects.at(-1));
    editor.events.onStatus(`Select All · ${objects.length} object(s)`);
    return true;
  }

  function objectSelectNone() {
    editor.clearSelection();
    editor.events.onStatus('Select None');
    return true;
  }

  function objectInvert() {
    const objects = selectableObjects(editor);
    const currentlySelected = new Set(editor.getSelectedObjects());
    const next = objects.filter((object) => !currentlySelected.has(object));
    if (next.length) editor.selectMany(next, next.at(-1));
    else editor.clearSelection();
    editor.events.onStatus(`Invert Select · ${next.length} object(s)`);
    return true;
  }

  editMode.invertSelection = () => invertEditSelection(editMode);
  editMode.selectLinked = () => selectLinked(editMode);

  const api = {
    objectSelectAll,
    objectSelectNone,
    objectInvert,
    editInvert: editMode.invertSelection,
    editLinked: editMode.selectLinked,
  };
  editor.selectionTools = api;
  return api;
}
