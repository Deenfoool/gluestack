import { installUVWorkspace } from './uv/integration.js';
import { installMaterialPanel } from './materials/integration.js';
import { installProjects } from './projects/integration.js';
import { installGameReady } from './game-ready/integration.js';

export function installFeatures({ editor, editMode, knifeTool, requestNumber }) {
  const uv = installUVWorkspace({ editor, editMode, knifeTool, requestNumber });
  const materials = installMaterialPanel({ editor });
  const projects = installProjects({ editor, editMode, knifeTool });
  const gameReady = installGameReady({ editor });

  const previousSelectionHandler = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelectionHandler(...args);
    if (materials && !materials.panel.hidden) materials.refresh();
  };

  return { uv, materials, projects, gameReady };
}
