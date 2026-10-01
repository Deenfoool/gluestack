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
  const resources = await loadAndInstall(editor, 'Resource ownership', () => import('./runtime/resource-ownership.js'), ({ installResourceOwnership }) => installResourceOwnership(editor));
  const transformIntegrity = await loadAndInstall(editor, 'Transform integrity', () => import('./runtime/transform-integrity.js'), ({ installTransformIntegrity }) => installTransformIntegrity(editor));
  const animations = await loadAndInstall(editor, 'Animations', () => import('./runtime/animations.js'), ({ installAnimations }) => installAnimations(editor));
  const metadataPolicy = await loadAndInstall(editor, 'Metadata policy', () => import('./runtime/metadata-policy.js'), ({ installMetadataPolicy }) => installMetadataPolicy(editor));
  const cleanExport = await loadAndInstall(editor, 'Clean GLB export', () => import('./runtime/export-clean.js'), ({ installCleanExport }) => installCleanExport(editor));
  const exportSelected = await loadAndInstall(editor, 'Export Selected', () => import('./runtime/export-selected.js'), ({ installExportSelected }) => installExportSelected({ editor }));
  const animationEditor = await loadAndInstall(editor, 'Animation editor', () => import('./runtime/animation-editor.js'), ({ installAnimationEditor }) => installAnimationEditor(editor));
  const dopeSheet = await loadAndInstall(editor, 'Dope Sheet', () => import('./runtime/dope-sheet.js'), ({ installDopeSheet }) => installDopeSheet(editor));
  const importer = await loadAndInstall(editor, 'GLTF importer', () => import('./runtime/importer.js'), ({ installImportPipeline }) => installImportPipeline({ editor, editMode, knifeTool }));

  let modifierStack = editor.modifierStack ?? null;
  if (!modifierStack && editor.modifierStackReady) {
    try { modifierStack = await editor.modifierStackReady; }
    catch (error) {
      console.error('[gluestack] Modifier Stack bootstrap failed', error);
      editor.events.onStatus(`Modifier Stack: модуль не загрузился — ${error.message || error}`);
    }
  }

  const uv = await loadAndInstall(editor, 'UV Editing', () => import('./uv/integration.js'), ({ installUVWorkspace }) => installUVWorkspace({ editor, editMode, knifeTool, requestNumber }));
  const uvWorkspace = () => document.querySelector('#uv-workspace');
  const advancedUV = await loadAndInstall(editor, 'Advanced UV', () => import('./uv/advanced.js'), ({ installAdvancedUV }) => installAdvancedUV({ controller: uv?.controller, workspace: uvWorkspace(), editor }));
  const smartIslands = await loadAndInstall(editor, 'Smart UV islands', () => import('./uv/smart-islands.js'), ({ installSmartIslands }) => installSmartIslands({ controller: uv?.controller, workspace: uvWorkspace() }));
  const harmonicUnwrap = await loadAndInstall(editor, 'Harmonic UV unwrap', () => import('./uv/unwrap-solver.js'), ({ installHarmonicUnwrap }) => installHarmonicUnwrap({ controller: uv?.controller, workspace: uvWorkspace() }));
  const uvRelax = await loadAndInstall(editor, 'UV Relax', () => import('./uv/relax.js'), ({ installUVRelax }) => installUVRelax({ controller: uv?.controller, workspace: uvWorkspace() }));
  const uvIslandTools = await loadAndInstall(editor, 'UV island tools', () => import('./uv/island-tools.js'), ({ installUVIslandTools }) => installUVIslandTools({ controller: uv?.controller, workspace: uvWorkspace() }));

  const materials = await loadAndInstall(editor, 'Materials', () => import('./materials/integration.js'), ({ installMaterialPanel }) => installMaterialPanel({ editor }));
  const projects = await loadAndInstall(editor, 'Projects', () => import('./projects/integration.js'), ({ installProjects }) => installProjects({ editor, editMode, knifeTool }));
  const gameReady = await loadAndInstall(editor, 'Game Ready', () => import('./game-ready/integration.js'), ({ installGameReady }) => installGameReady({ editor }));
  const gameReadyValidator = await loadAndInstall(editor, 'Game Ready validator v2', () => import('./game-ready/validator-v2.js'), ({ installGameReadyValidatorV2 }) => installGameReadyValidatorV2({ editor, gameReady }));
  const lodPolicy = await loadAndInstall(editor, 'LOD policy', () => import('./game-ready/lod-policy.js'), ({ installLODPolicy }) => installLODPolicy({ editor, gameReady }));
  const optimizerV2 = await loadAndInstall(editor, 'Game Ready optimizer v2', () => import('./game-ready/optimizer-v2.js'), ({ installGameReadyOptimizerV2 }) => installGameReadyOptimizerV2({ editor, gameReady }));
  const exportProfiles = await loadAndInstall(editor, 'Export profiles', () => import('./game-ready/export-profiles.js'), ({ installExportProfiles }) => installExportProfiles({ editor, gameReady, optimizerV2 }));
  const cleanupAudit = await loadAndInstall(editor, 'Cleanup Preview', () => import('./game-ready/cleanup-audit.js'), ({ installCleanupAudit }) => installCleanupAudit({ editor, gameReady }));
  const integrity = await loadAndInstall(editor, 'Data integrity', () => import('./runtime/data-integrity.js'), ({ installDataIntegrity }) => installDataIntegrity({ editor, editMode, gameReady }));
  const paint = await loadAndInstall(editor, 'Texture Paint', () => import('./paint/integration.js'), ({ installTexturePaint }) => installTexturePaint({ editor, editMode, knifeTool, materials }));
  const procedural = await loadAndInstall(editor, 'Procedural', () => import('./procedural/integration.js'), ({ installProceduralGenerators }) => installProceduralGenerators({ editor }));
  const scene = await loadAndInstall(editor, 'Scene controls', () => import('./scene/integration.js'), ({ installSceneControls }) => installSceneControls({ editor }));
  const viewportHistory = await loadAndInstall(editor, 'Viewport history', () => import('./runtime/viewport-history.js'), ({ installViewportHistory }) => installViewportHistory(editor));

  const previousSelectionHandler = editor.events.onSelection;
  editor.events.onSelection = (...args) => {
    previousSelectionHandler(...args);
    if (materials && !materials.panel.hidden) materials.refresh();
    modifierStack?.render?.();
    lodPolicy?.render?.();
  };

  document.querySelector('.workspace-tabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('.workspace-tab');
    if (!tab || tab.disabled) return;
    document.querySelectorAll('.workspace-tab').forEach((item) => item.classList.toggle('active', item === tab));
  });

  const hardening = await loadAndInstall(editor, 'Runtime hardening', () => import('./runtime/hardening.js'), ({ installRuntimeHardening }) => installRuntimeHardening({ editor, projects, editMode }));

  const installed = {
    uv, advancedUV, smartIslands, harmonicUnwrap, uvRelax, uvIslandTools,
    materials, projects, gameReady, gameReadyValidator, lodPolicy, optimizerV2, exportProfiles, cleanupAudit,
    paint, procedural, scene, hardening, resources, transformIntegrity, importer, integrity,
    viewportHistory, animations, animationEditor, dopeSheet, modifierStack, metadataPolicy, cleanExport, exportSelected,
  };

  const diagnostics = await loadAndInstall(editor, 'Diagnostics', () => import('./runtime/diagnostics.js'), ({ installDiagnostics }) => installDiagnostics({ editor, projects, features: installed }));
  const metadataAudit = await loadAndInstall(editor, 'Metadata audit', () => import('./runtime/metadata-audit.js'), ({ installMetadataAudit }) => installMetadataAudit({ editor, projects, diagnostics }));
  const goldenDiagnostics = await loadAndInstall(editor, 'Golden fixtures', () => import('./runtime/golden-diagnostics.js'), ({ installGoldenDiagnostics }) => installGoldenDiagnostics({ editor, diagnostics, importer, projects }));
  const uvGoldenDiagnostics = await loadAndInstall(editor, 'UV Golden fixtures', () => import('./runtime/uv-golden-diagnostics.js'), ({ installUVGoldenDiagnostics }) => installUVGoldenDiagnostics({ editor, diagnostics, uv, advancedUV }));
  const modifierStackDiagnostics = await loadAndInstall(editor, 'Modifier Stack diagnostics', () => import('./runtime/modifier-stack-diagnostics.js'), ({ installModifierStackDiagnostics }) => installModifierStackDiagnostics({ editor, diagnostics, modifierStack }));
  const importExportDiagnostics = await loadAndInstall(editor, 'Import / Export diagnostics', () => import('./runtime/import-export-diagnostics.js'), ({ installImportExportDiagnostics }) => installImportExportDiagnostics({ editor, diagnostics, importer }));
  const destructiveGuardDiagnostics = await loadAndInstall(editor, 'Destructive guard diagnostics', () => import('./runtime/destructive-guard-diagnostics.js'), ({ installDestructiveGuardDiagnostics }) => installDestructiveGuardDiagnostics({ editor, diagnostics }));
  const releaseGate = await loadAndInstall(
    editor,
    'v1 Release Gate',
    () => import('./runtime/release-gate.js'),
    ({ installReleaseGate }) => installReleaseGate({
      editor,
      diagnostics,
      transformIntegrity,
      metadataAudit,
      goldenDiagnostics,
      uvGoldenDiagnostics,
      modifierStackDiagnostics,
      importExportDiagnostics,
      destructiveGuardDiagnostics,
    }),
  );

  const result = {
    ...installed,
    diagnostics,
    metadataAudit,
    goldenDiagnostics,
    uvGoldenDiagnostics,
    modifierStackDiagnostics,
    importExportDiagnostics,
    destructiveGuardDiagnostics,
    releaseGate,
  };
  const failed = Object.entries(result).filter(([, value]) => !value).map(([name]) => name);
  if (failed.length) editor.events.onStatus(`Базовый редактор готов · не загрузились: ${failed.join(', ')}`);
  else editor.events.onStatus('Готово · все дополнительные модули подключены');
  return result;
}
