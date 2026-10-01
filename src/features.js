async function loadAndInstall(editor, name, loader, installer) {
  try {
    const module = await loader();
    return installer(module);
  } catch (error) {
    console.error(`[gluestack] ${name} failed to load/install`, error);
    editor.events.onStatus(`${name}: модуль не загрузился — см. консоль`);
    return null;
  }
}

export async function installFeatures({ editor, editMode, knifeTool, requestNumber }) {
  const resources = await loadAndInstall(
    editor,
    'Resource ownership',
    () => import('./runtime/resource-ownership.js'),
    ({ installResourceOwnership }) => installResourceOwnership(editor),
  );

  const animations = await loadAndInstall(
    editor,
    'Animations',
    () => import('./runtime/animations.js'),
    ({ installAnimations }) => installAnimations(editor),
  );

  const cleanExport = await loadAndInstall(
    editor,
    'Clean GLB export',
    () => import('./runtime/export-clean.js'),
    ({ installCleanExport }) => installCleanExport(editor),
  );

  const animationEditor = await loadAndInstall(
    editor,
    'Animation editor',
    () => import('./runtime/animation-editor.js'),
    ({ installAnimationEditor }) => installAnimationEditor(editor),
  );

  const dopeSheet = await loadAndInstall(
    editor,
    'Dope Sheet',
    () => import('./runtime/dope-sheet.js'),
    ({ installDopeSheet }) => installDopeSheet(editor),
  );

  const importer = await loadAndInstall(
    editor,
    'GLTF importer',
    () => import('./runtime/importer.js'),
    ({ installImportPipeline }) => installImportPipeline({ editor, editMode, knifeTool }),
  );

  let modifierStack = editor.modifierStack ?? null;
  if (!modifierStack && editor.modifierStackReady) {
    try {
      modifierStack = await editor.modifierStackReady;
    } catch (error) {
      console.error('[gluestack] Modifier Stack bootstrap failed', error);
      editor.events.onStatus(`Modifier Stack: модуль не загрузился — ${error.message || error}`);
    }
  }

  const uv = await loadAndInstall(
    editor,
    'UV Editing',
    () => import('./uv/integration.js'),
    ({ installUVWorkspace }) => installUVWorkspace({ editor, editMode, knifeTool, requestNumber }),
  );

  const materials = await loadAndInstall(
    editor,
    'Materials',
    () => import('./materials/integration.js'),
    ({ installMaterialPanel }) => installMaterialPanel({ editor }),
  );

  const projects = await loadAndInstall(
    editor,
    'Projects',
    () => import('./projects/integration.js'),
    ({ installProjects }) => installProjects({ editor, editMode, knifeTool }),
  );

  const gameReady = await loadAndInstall(
    editor,
    'Game Ready',
    () => import('./game-ready/integration.js'),
    ({ installGameReady }) => installGameReady({ editor }),
  );

  const integrity = await loadAndInstall(
    editor,
    'Data integrity',
    () => import('./runtime/data-integrity.js'),
    ({ installDataIntegrity }) => installDataIntegrity({ editor, editMode, gameReady }),
  );

  const paint = await loadAndInstall(
    editor,
    'Texture Paint',
    () => import('./paint/integration.js'),
    ({ installTexturePaint }) => installTexturePaint({ editor, editMode, knifeTool, materials }),
  );

  const procedural = await loadAndInstall(
    editor,
    'Procedural',
    () => import('./procedural/integration.js'),
    ({ installProceduralGenerators }) => installProceduralGenerators({ editor }),
  );

  const scene = await loadAndInstall(
    editor,
    'Scene controls',
    () => import('./scene/integration.js'),
    ({ installSceneControls }) => installSceneControls({ editor }),
  );

  const viewportHistory = await loadAndInstall(
    editor,
    'Viewport history',
    () => import('./runtime/viewport-history.js'),
    ({ installViewportHistory }) => installViewportHistory(editor),
  );

  const previousSelectionHandler = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelectionHandler(...args);
    if (materials && !materials.panel.hidden) materials.refresh();
    modifierStack?.render?.();
  };

  document.querySelector('.workspace-tabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('.workspace-tab');
    if (!tab || tab.disabled) return;
    document.querySelectorAll('.workspace-tab').forEach((item) => item.classList.toggle('active', item === tab));
  });

  const hardening = await loadAndInstall(
    editor,
    'Runtime hardening',
    () => import('./runtime/hardening.js'),
    ({ installRuntimeHardening }) => installRuntimeHardening({ editor, projects, editMode }),
  );

  const installed = {
    uv,
    materials,
    projects,
    gameReady,
    paint,
    procedural,
    scene,
    hardening,
    resources,
    importer,
    integrity,
    viewportHistory,
    animations,
    animationEditor,
    dopeSheet,
    modifierStack,
    cleanExport,
  };

  const diagnostics = await loadAndInstall(
    editor,
    'Diagnostics',
    () => import('./runtime/diagnostics.js'),
    ({ installDiagnostics }) => installDiagnostics({ editor, projects, features: installed }),
  );

  const goldenDiagnostics = await loadAndInstall(
    editor,
    'Golden fixtures',
    () => import('./runtime/golden-diagnostics.js'),
    ({ installGoldenDiagnostics }) => installGoldenDiagnostics({ editor, diagnostics }),
  );

  const result = { ...installed, diagnostics, goldenDiagnostics };
  const failed = Object.entries(result).filter(([, value]) => !value).map(([name]) => name);
  if (failed.length) editor.events.onStatus(`Базовый редактор готов · не загрузились: ${failed.join(', ')}`);
  else editor.events.onStatus('Готово · все дополнительные модули подключены');
  return result;
}
