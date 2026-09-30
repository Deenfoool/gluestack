import { installUVWorkspace } from './uv/integration.js';
import { installMaterialPanel } from './materials/integration.js';
import { installProjects } from './projects/integration.js';
import { installGameReady } from './game-ready/integration.js';
import { installTexturePaint } from './paint/integration.js';
import { installProceduralGenerators } from './procedural/integration.js';
import { installSceneControls } from './scene/integration.js';
import { installRuntimeHardening } from './runtime/hardening.js';

export function installFeatures({ editor, editMode, knifeTool, requestNumber }) {
  const uv = installUVWorkspace({ editor, editMode, knifeTool, requestNumber });
  const materials = installMaterialPanel({ editor });
  const projects = installProjects({ editor, editMode, knifeTool });
  const gameReady = installGameReady({ editor });
  const paint = installTexturePaint({ editor, editMode, knifeTool });
  const procedural = installProceduralGenerators({ editor });
  const scene = installSceneControls({ editor });

  const previousSelectionHandler = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelectionHandler(...args);
    if (materials && !materials.panel.hidden) materials.refresh();
  };

  document.querySelector('.workspace-tabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('.workspace-tab');
    if (!tab || tab.disabled) return;
    document.querySelectorAll('.workspace-tab').forEach((item) => item.classList.toggle('active', item === tab));
  });

  const hardening = installRuntimeHardening({ editor, projects });
  return { uv, materials, projects, gameReady, paint, procedural, scene, hardening };
}
