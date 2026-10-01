const PROFILES = Object.freeze({
  web: { id: 'web', label: 'Web', defaultMaxTextureSize: 2048 },
  generic: { id: 'generic', label: 'Generic glTF', defaultMaxTextureSize: 4096 },
  godot: { id: 'godot', label: 'Godot', defaultMaxTextureSize: 4096 },
  unity: { id: 'unity', label: 'Unity', defaultMaxTextureSize: 4096 },
});

export function installExportProfiles({ editor, gameReady, optimizerV2 }) {
  const card = optimizerV2?.card;
  const controller = gameReady?.controller;
  if (!editor || !card || !controller || editor.exportProfiles) return editor?.exportProfiles ?? null;

  const profileInput = card.querySelector('[data-opt-profile]');
  const maxTextureInput = card.querySelector('[data-opt-max-texture]');
  if (!profileInput || !maxTextureInput) return null;

  const note = document.createElement('div');
  note.className = 'game-ready-note export-profile-note';
  card.appendChild(note);

  function sync({ applyDefault = false } = {}) {
    const preset = PROFILES[profileInput.value] ?? PROFILES.generic;
    if (applyDefault) maxTextureInput.value = String(preset.defaultMaxTextureSize);
    const maxTextureSize = Math.max(128, Number(maxTextureInput.value) || preset.defaultMaxTextureSize);
    editor.exportProfile = {
      id: preset.id,
      label: preset.label,
      maxTextureSize,
      preserveAlpha: true,
      coordinatePolicy: 'preserve-source',
    };
    note.textContent = `${preset.label} export · max texture ${maxTextureSize}px · alpha preserved · source scale/up-axis preserved`;
    return editor.exportProfile;
  }

  profileInput.addEventListener('change', () => {
    const profile = sync({ applyDefault: true });
    controller.status(`Export Profile · ${profile.label} · ${profile.maxTextureSize}px`);
  });
  maxTextureInput.addEventListener('change', () => {
    const profile = sync();
    controller.status(`Export Profile · ${profile.label} · max texture ${profile.maxTextureSize}px`);
  });

  const api = {
    profiles: PROFILES,
    sync,
    current: () => editor.exportProfile,
  };
  editor.exportProfiles = api;
  sync();
  return api;
}
