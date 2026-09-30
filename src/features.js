import { installUVWorkspace } from './uv/integration.js';
import { installMaterialPanel } from './materials/integration.js';
import { installProjects } from './projects/integration.js';
import { installGameReady } from './game-ready/integration.js';
import { installTexturePaint } from './paint/integration.js';
import { installProceduralGenerators } from './procedural/integration.js';
import { installSceneControls } from './scene/integration.js';
import { installRuntimeHardening } from './runtime/hardening.js';
import { installDiagnostics } from './runtime/diagnostics.js';
import { installResourceOwnership } from './runtime/resource-ownership.js';
import { installImportPipeline } from './runtime/importer.js';
import { installDataIntegrity } from './runtime/data-integrity.js';

function safeInstall(editor, name, factory) {
  try {
    return factory();
  } catch (error) {
    console.error(`[gluestack] ${name} failed to install`, error);
    editor.events.onStatus(`${name}: модуль не загрузился — см. консоль`);
    return null;
  }
}

export function installFeatures({ editor, editMode, knifeTool, requestNumber }) {
  const resources = safeInstall(editor, 'Resource ownership', () => installResourceOwnership(editor));
  const importer = safeInstall(editor, 'GLTF importer', () => installImportPipeline({ editor, editMode, knifeTool }));
  const uv = safeInstall(editor, 'UV Editing', () => installUVWorkspace({ editor, editMode, knifeTool, requestNumber }));
  const materials = safeInstall(editor, 'Materials', () => installMaterialPanel({ editor }));
  const projects = safeInstall(editor, 'Projects', () => installProjects({ editor, editMode, knifeTool }));
  const gameReady = safeInstall(editor, 'Game Ready', () => installGameReady({ editor }));
  const integrity = safeInstall(editor, 'Data integrity', () => installDataIntegrity({ editor, editMode, gameReady }));
  const paint = safeInstall(editor, 'Texture Paint', () => installTexturePaint({ editor, editMode, knifeTool }));
  const procedural = safeInstall(editor, 'Procedural', () => installProceduralGenerators({ editor }));
  const scene = safeInstall(editor, 'Scene controls', () => installSceneControls({ editor }));

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

  const hardening = safeInstall(editor, 'Runtime hardening', () => installRuntimeHardening({ editor, projects, editMode }));
  const installed = { uv, materials, projects, gameReady, paint, procedural, scene, hardening, resources, importer, integrity };
  const diagnostics = safeInstall(editor, 'Diagnostics', () => installDiagnostics({ editor, projects, features: installed }));
  return { ...installed, diagnostics };
}
