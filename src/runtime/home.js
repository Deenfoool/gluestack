import * as THREE from 'three';
import { refreshIcons } from '../ui.js';

const AUTOSAVE_ID = '__autosave__';
const AUTOSAVE_BACKUP_ID = '__autosave_backup__';

const COPY = {
  ru: {
    home: 'Главная',
    tagline: 'Создавай game-ready 3D прямо в браузере',
    subline: 'Моделирование, UV, PBR, Texture Paint, анимация и чистый GLB — в одном локальном редакторе.',
    newProject: 'Новый проект',
    openProject: 'Открыть проект',
    importModel: 'Импорт GLB / GLTF',
    recent: 'Последние проекты',
    noRecent: 'Локальных проектов пока нет',
    noRecentHint: 'Сохрани проект через Ctrl+S — он появится здесь.',
    templates: 'Начать с шаблона',
    empty: 'Пустая сцена',
    emptyDesc: 'Чистая сцена без объектов.',
    cube: 'Куб',
    cubeDesc: 'Стандартный старт для моделирования.',
    gameAsset: 'Game Asset',
    gameAssetDesc: 'PBR-куб и подготовка под игровой ассет.',
    lowPoly: 'Low Poly',
    lowPolyDesc: 'Низкополигональная форма для быстрого старта.',
    materialTest: 'Material Test',
    materialTestDesc: 'Сфера для проверки PBR и текстур.',
    environment: 'Environment',
    environmentDesc: 'Плоскость и базовые объекты окружения.',
    quickStart: 'Быстрый старт',
    nav: 'Навигация',
    navText: 'СКМ — вращение · Shift+СКМ — панорама · колесо — масштаб.',
    modeling: 'Моделирование',
    modelingText: 'Tab → Edit Mode · 1/2/3 → вершины/рёбра/грани · E/I/Ctrl+B — интерактивные инструменты.',
    uv: 'UV и материалы',
    uvText: 'UV-развёртка → швы → Pack Islands → PBR материалы → Texture Paint.',
    whatsNew: 'Что нового',
    recovery: 'Восстановление',
    system: 'Система',
    settings: 'Настройки',
    github: 'GitHub',
    open: 'Открыть',
    recover: 'Восстановить',
    backup: 'Предыдущий autosave',
    currentAutosave: 'Последний autosave',
    noAutosave: 'Autosave пока не создан',
    saved: 'Сохранён',
    meshes: 'mesh',
    materials: 'материалов',
    textures: 'текстур',
    animations: 'анимаций',
    remove: 'Удалить локально',
    unsavedTitle: 'Есть несохранённые изменения',
    unsavedText: 'Продолжить и заменить текущую сцену? Autosave останется доступен для восстановления.',
    continue: 'Продолжить',
    cancel: 'Отмена',
    created: 'Создан новый проект',
    opened: 'Проект открыт',
    imported: 'Модель импортирована',
    loading: 'Загрузка…',
    webgl: 'WebGL',
    indexedDb: 'IndexedDB',
    autosave: 'Autosave',
    enabled: 'Включён',
    disabled: 'Выключен',
    gpu: 'GPU',
    version: 'Версия',
    runDiagnostics: 'Запустить v1 Release Gate',
    tutorial: 'Учебная сцена',
    tutorialDesc: 'Откроет куб в Edit Mode и подготовит короткое упражнение по интерактивному Extrude.',
    startLesson: 'Начать урок',
    recentHint: 'Локальные .gluestack проекты хранятся в этом браузере.',
    recoveryHint: 'Восстановление использует generation-safe autosave и предыдущую резервную копию.',
    newInteractive: 'Интерактивные Extrude / Inset / Bevel / Loop Cut с ghost-preview',
    newHome: 'Главный Home-хаб с recent projects и recovery',
    newI18n: 'Русский / English интерфейс',
    newStack: 'Неразрушающий Modifier Stack и улучшенный UV pipeline',
    deleteTitle: 'Удалить локальный проект?',
    deleteText: 'Файл из IndexedDB этого браузера будет удалён. Скачанные .gluestack файлы не затрагиваются.',
    delete: 'Удалить',
  },
  en: {
    home: 'Home',
    tagline: 'Create game-ready 3D directly in your browser',
    subline: 'Modeling, UV, PBR, Texture Paint, animation and clean GLB export in one local editor.',
    newProject: 'New Project',
    openProject: 'Open Project',
    importModel: 'Import GLB / GLTF',
    recent: 'Recent Projects',
    noRecent: 'No local projects yet',
    noRecentHint: 'Save with Ctrl+S and the project will appear here.',
    templates: 'Start from a template',
    empty: 'Empty Scene',
    emptyDesc: 'A clean scene with no objects.',
    cube: 'Cube',
    cubeDesc: 'Standard modeling starting point.',
    gameAsset: 'Game Asset',
    gameAssetDesc: 'PBR cube configured as a game asset starter.',
    lowPoly: 'Low Poly',
    lowPolyDesc: 'A lightweight low-poly shape for quick work.',
    materialTest: 'Material Test',
    materialTestDesc: 'Sphere for checking PBR materials and textures.',
    environment: 'Environment',
    environmentDesc: 'Ground plane and basic environment objects.',
    quickStart: 'Quick Start',
    nav: 'Navigation',
    navText: 'MMB orbit · Shift+MMB pan · wheel zoom.',
    modeling: 'Modeling',
    modelingText: 'Tab → Edit Mode · 1/2/3 → vertex/edge/face · E/I/Ctrl+B → interactive tools.',
    uv: 'UV & Materials',
    uvText: 'UV Editing → seams → Pack Islands → PBR materials → Texture Paint.',
    whatsNew: "What's New",
    recovery: 'Recovery',
    system: 'System',
    settings: 'Settings',
    github: 'GitHub',
    open: 'Open',
    recover: 'Recover',
    backup: 'Previous autosave',
    currentAutosave: 'Latest autosave',
    noAutosave: 'No autosave yet',
    saved: 'Saved',
    meshes: 'meshes',
    materials: 'materials',
    textures: 'textures',
    animations: 'animations',
    remove: 'Delete local',
    unsavedTitle: 'Unsaved changes',
    unsavedText: 'Continue and replace the current scene? Autosave remains available for recovery.',
    continue: 'Continue',
    cancel: 'Cancel',
    created: 'New project created',
    opened: 'Project opened',
    imported: 'Model imported',
    loading: 'Loading…',
    webgl: 'WebGL',
    indexedDb: 'IndexedDB',
    autosave: 'Autosave',
    enabled: 'Enabled',
    disabled: 'Disabled',
    gpu: 'GPU',
    version: 'Version',
    runDiagnostics: 'Run v1 Release Gate',
    tutorial: 'Training Scene',
    tutorialDesc: 'Opens a cube in Edit Mode and prepares a short interactive Extrude exercise.',
    startLesson: 'Start lesson',
    recentHint: 'Local .gluestack projects are stored in this browser.',
    recoveryHint: 'Recovery uses generation-safe autosave and the previous backup copy.',
    newInteractive: 'Interactive Extrude / Inset / Bevel / Loop Cut with ghost previews',
    newHome: 'Home hub with recent projects and recovery',
    newI18n: 'Russian / English interface',
    newStack: 'Non-destructive Modifier Stack and improved UV pipeline',
    deleteTitle: 'Delete local project?',
    deleteText: 'The IndexedDB copy in this browser will be removed. Downloaded .gluestack files are not affected.',
    delete: 'Delete',
  },
};

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDate(value, language) {
  if (!Number.isFinite(Number(value))) return '—';
  try {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch { return new Date(value).toLocaleString(); }
}

function ensureStylesheet() {
  if (document.querySelector('link[data-gluestack-home-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './home.css';
  link.dataset.gluestackHomeStyle = '';
  document.head.appendChild(link);
}

function wirePreview(seed = 0) {
  const shift = Math.abs(Number(seed) || 0) % 18;
  return `<svg class="home-project-wire" viewBox="0 0 160 96" aria-hidden="true">
    <defs><linearGradient id="g${shift}" x1="0" x2="1"><stop offset="0" stop-color="#f59b23" stop-opacity=".68"/><stop offset="1" stop-color="#6cc7ff" stop-opacity=".42"/></linearGradient></defs>
    <g fill="none" stroke="url(#g${shift})" stroke-width="1.2" opacity=".92">
      <path d="M38 ${22 + shift * .18} 92 14 128 38 73 49Z"/><path d="M38 ${22 + shift * .18}v39l35 22 55-13V38"/><path d="M73 49v34"/><path d="M38 61l55-12 35 21"/><path d="M92 14l1 35"/>
    </g>
    <g fill="#f59b23"><circle cx="38" cy="${22 + shift * .18}" r="2"/><circle cx="92" cy="14" r="2"/><circle cx="128" cy="38" r="2"/><circle cx="73" cy="49" r="2"/><circle cx="38" cy="61" r="2"/><circle cx="73" cy="83" r="2"/><circle cx="128" cy="70" r="2"/></g>
  </svg>`;
}

export function installHome({ editor, projects, settings, i18n, importer, editMode, knifeTool }) {
  if (!editor || !projects || !settings || !i18n) return null;
  if (window.__gluestackHome) return window.__gluestackHome;
  ensureStylesheet();

  const root = document.createElement('div');
  root.id = 'gluestack-home';
  root.className = 'gluestack-home';
  root.setAttribute('role', 'main');
  document.body.appendChild(root);

  let visible = true;
  let confirmResolver = null;
  let refreshToken = 0;

  const language = () => i18n.getLanguage?.() === 'en' ? 'en' : 'ru';
  const t = (key) => COPY[language()][key] ?? key;

  function renderShell() {
    root.innerHTML = `
      <div class="home-shell">
        <header class="home-topbar">
          <button class="home-brand" type="button" data-home-action="home" aria-label="gluestack Home">
            <span class="home-brand-mark">g</span><span>gluestack</span><em>3D Editor</em>
          </button>
          <div class="home-top-actions">
            <div class="home-lang" role="group" aria-label="Language">
              <button type="button" data-home-language="ru" class="${language() === 'ru' ? 'active' : ''}">RU</button>
              <button type="button" data-home-language="en" class="${language() === 'en' ? 'active' : ''}">EN</button>
            </div>
            <button type="button" class="home-icon-button" data-home-action="settings" title="${esc(t('settings'))}"><i data-lucide="settings"></i></button>
            <a class="home-icon-button" href="https://github.com/Deenfoool/gluestack" target="_blank" rel="noreferrer" title="GitHub"><i data-lucide="github"></i></a>
          </div>
        </header>

        <main class="home-content">
          <section class="home-hero">
            <div class="home-hero-copy">
              <span class="home-eyebrow">WEB · GLB · LOCAL-FIRST</span>
              <h1>${esc(t('tagline'))}</h1>
              <p>${esc(t('subline'))}</p>
              <div class="home-primary-actions">
                <button type="button" class="home-button primary" data-home-action="new"><i data-lucide="plus"></i><span>${esc(t('newProject'))}</span></button>
                <button type="button" class="home-button" data-home-action="open-file"><i data-lucide="folder-open"></i><span>${esc(t('openProject'))}</span></button>
                <button type="button" class="home-button" data-home-action="import"><i data-lucide="upload"></i><span>${esc(t('importModel'))}</span></button>
              </div>
            </div>
            <div class="home-hero-visual" aria-hidden="true">
              <div class="home-hero-grid"></div>
              <div class="home-wire-cube">
                <i class="wc v1"></i><i class="wc v2"></i><i class="wc v3"></i><i class="wc v4"></i><i class="wc v5"></i><i class="wc v6"></i><i class="wc v7"></i><i class="wc v8"></i>
                <span class="wc-edge e1"></span><span class="wc-edge e2"></span><span class="wc-edge e3"></span><span class="wc-edge e4"></span>
                <span class="wc-edge e5"></span><span class="wc-edge e6"></span><span class="wc-edge e7"></span><span class="wc-edge e8"></span>
                <span class="wc-edge e9"></span><span class="wc-edge e10"></span><span class="wc-edge e11"></span><span class="wc-edge e12"></span>
              </div>
              <div class="home-hero-chip">OBJECT / EDIT / UV / PAINT</div>
            </div>
          </section>

          <section class="home-section home-recent-section">
            <div class="home-section-heading"><div><h2>${esc(t('recent'))}</h2><p>${esc(t('recentHint'))}</p></div><button type="button" class="home-text-button" data-home-action="refresh"><i data-lucide="refresh-cw"></i></button></div>
            <div class="home-recent-grid" data-home-recent><div class="home-loading">${esc(t('loading'))}</div></div>
          </section>

          <div class="home-two-column">
            <section class="home-section" id="home-templates">
              <div class="home-section-heading"><div><h2>${esc(t('templates'))}</h2></div></div>
              <div class="home-template-grid">
                ${templateCard('empty', 'square-dashed', t('empty'), t('emptyDesc'))}
                ${templateCard('cube', 'box', t('cube'), t('cubeDesc'))}
                ${templateCard('game-asset', 'badge-check', t('gameAsset'), t('gameAssetDesc'))}
                ${templateCard('low-poly', 'gem', t('lowPoly'), t('lowPolyDesc'))}
                ${templateCard('material-test', 'circle-dot', t('materialTest'), t('materialTestDesc'))}
                ${templateCard('environment', 'mountain', t('environment'), t('environmentDesc'))}
              </div>
            </section>

            <section class="home-section home-recovery-section">
              <div class="home-section-heading"><div><h2>${esc(t('recovery'))}</h2><p>${esc(t('recoveryHint'))}</p></div></div>
              <div data-home-recovery><div class="home-loading">${esc(t('loading'))}</div></div>
            </section>
          </div>

          <div class="home-three-column">
            <section class="home-section">
              <div class="home-section-heading"><div><h2>${esc(t('quickStart'))}</h2></div></div>
              <div class="home-guide-list">
                ${guide('mouse-pointer-2', t('nav'), t('navText'))}
                ${guide('boxes', t('modeling'), t('modelingText'))}
                ${guide('unfold-vertical', t('uv'), t('uvText'))}
              </div>
              <button type="button" class="home-button compact" data-home-action="lesson"><i data-lucide="graduation-cap"></i><span>${esc(t('startLesson'))}</span></button>
              <p class="home-small-copy">${esc(t('tutorialDesc'))}</p>
            </section>

            <section class="home-section">
              <div class="home-section-heading"><div><h2>${esc(t('whatsNew'))}</h2><p>Pre-v1.0</p></div></div>
              <ul class="home-changelog">
                <li>${esc(t('newInteractive'))}</li>
                <li>${esc(t('newHome'))}</li>
                <li>${esc(t('newI18n'))}</li>
                <li>${esc(t('newStack'))}</li>
              </ul>
            </section>

            <section class="home-section">
              <div class="home-section-heading"><div><h2>${esc(t('system'))}</h2></div></div>
              <div class="home-system-list" data-home-system></div>
              <button type="button" class="home-button compact" data-home-action="diagnostics"><i data-lucide="activity"></i><span>${esc(t('runDiagnostics'))}</span></button>
            </section>
          </div>
        </main>

        <footer class="home-footer"><span>gluestack · local-first browser 3D editor</span><span>Three.js · IndexedDB · GitHub Pages</span></footer>
      </div>

      <input type="file" hidden data-home-project-input accept=".gluestack,application/octet-stream">
      <input type="file" hidden multiple data-home-import-input accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,model/gltf-binary,model/gltf+json,image/png,image/jpeg,image/webp">

      <div class="home-confirm" data-home-confirm hidden>
        <div class="home-confirm-card" role="dialog" aria-modal="true">
          <i data-lucide="triangle-alert"></i>
          <h3 data-home-confirm-title></h3>
          <p data-home-confirm-text></p>
          <div class="home-confirm-actions">
            <button type="button" class="home-button" data-home-confirm-result="false">${esc(t('cancel'))}</button>
            <button type="button" class="home-button primary danger" data-home-confirm-result="true">${esc(t('continue'))}</button>
          </div>
        </div>
      </div>`;
    refreshIcons();
  }

  function templateCard(id, icon, title, description) {
    return `<button type="button" class="home-template" data-home-template="${id}"><span class="home-template-icon"><i data-lucide="${icon}"></i></span><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span><i class="home-template-arrow" data-lucide="arrow-up-right"></i></button>`;
  }

  function guide(icon, title, description) {
    return `<div class="home-guide"><i data-lucide="${icon}"></i><div><strong>${esc(title)}</strong><p>${esc(description)}</p></div></div>`;
  }

  function setBusy(busy) {
    root.classList.toggle('is-busy', Boolean(busy));
  }

  function resetHistory() {
    const previousLoading = projects.isLoading;
    projects.isLoading = true;
    try {
      editor.cancelHistory?.();
      editor.clearHistoryStack?.(editor.undoStack);
      editor.clearHistoryStack?.(editor.redoStack);
      editor.emitHistory?.();
    } finally { projects.isLoading = previousLoading; }
  }

  function clearScene() {
    editor.clearSelection();
    for (const child of [...editor.modelRoot.children]) {
      editor.modelRoot.remove(child);
      editor.disposeObjectResources(child);
    }
    editor.registerAnimations?.([], { replace: true });
  }

  function finalizeNewProject(name = 'Untitled') {
    projects.name = name;
    resetHistory();
    projects.setDirty(true, 'home-new');
    projects.scheduleAutosave();
    editor.events.onStructure();
    editor.frameAll?.();
  }

  async function askDiscard() {
    if (!projects.dirty) return true;
    return ask(t('unsavedTitle'), t('unsavedText'), t('continue'));
  }

  function ask(title, text, actionLabel = t('continue')) {
    const panel = root.querySelector('[data-home-confirm]');
    if (!panel) return Promise.resolve(false);
    panel.querySelector('[data-home-confirm-title]').textContent = title;
    panel.querySelector('[data-home-confirm-text]').textContent = text;
    const confirm = panel.querySelector('[data-home-confirm-result="true"]');
    confirm.textContent = actionLabel;
    panel.hidden = false;
    return new Promise((resolve) => { confirmResolver = resolve; });
  }

  function resolveConfirm(value) {
    root.querySelector('[data-home-confirm]')?.setAttribute('hidden', '');
    const resolver = confirmResolver;
    confirmResolver = null;
    resolver?.(Boolean(value));
  }

  function makeTemplate(id) {
    const material = () => editor.makeMaterial();
    const addMesh = (geometry, name, options = {}) => {
      const mesh = new THREE.Mesh(geometry, material());
      mesh.name = name;
      if (options.flat) mesh.material.flatShading = true;
      if (options.position) mesh.position.fromArray(options.position);
      if (options.rotation) mesh.rotation.set(...options.rotation);
      editor.assignIds(mesh, true);
      editor.modelRoot.add(mesh);
      return mesh;
    };

    projects.isLoading = true;
    try {
      clearScene();
      let selected = null;
      if (id === 'cube') {
        selected = addMesh(new THREE.BoxGeometry(2, 2, 2), 'Cube');
      } else if (id === 'game-asset') {
        selected = addMesh(new THREE.BoxGeometry(2, 2, 2), 'GameAsset');
        selected.material.roughness = 0.48;
        selected.material.metalness = 0.08;
        selected.userData.gluestackTemplate = 'game-asset';
      } else if (id === 'low-poly') {
        selected = addMesh(new THREE.IcosahedronGeometry(1.25, 1), 'LowPoly', { flat: true });
      } else if (id === 'material-test') {
        selected = addMesh(new THREE.SphereGeometry(1.2, 48, 28), 'MaterialPreview');
        selected.material.roughness = 0.32;
        selected.material.metalness = 0.15;
      } else if (id === 'environment') {
        const ground = addMesh(new THREE.PlaneGeometry(10, 10, 5, 5), 'Ground', { rotation: [-Math.PI / 2, 0, 0] });
        ground.material.roughness = 0.9;
        selected = addMesh(new THREE.BoxGeometry(2, 2, 2), 'Environment_Block', { position: [0, 1, 0] });
        addMesh(new THREE.BoxGeometry(1, 3.2, 1), 'Environment_Pillar', { position: [2.2, 1.6, -1.1] });
      }
      if (selected) editor.select(selected);
      else editor.clearSelection();
    } finally { projects.isLoading = false; }
    finalizeNewProject('Untitled');
  }

  async function createFromTemplate(id) {
    if (!await askDiscard()) return;
    knifeTool?.cancel?.(true);
    if (editMode?.active) editMode.exit();
    makeTemplate(id);
    hide();
    editor.events.onStatus(`${t('created')} · ${COPY[language()][id === 'game-asset' ? 'gameAsset' : id === 'low-poly' ? 'lowPoly' : id === 'material-test' ? 'materialTest' : id] ?? id}`);
  }

  async function openLocal(id) {
    if (!await askDiscard()) return;
    setBusy(true);
    try {
      knifeTool?.cancel?.(true);
      if (editMode?.active) editMode.exit();
      await projects.openLocal(id);
      resetHistory();
      hide();
      editor.events.onStatus(t('opened'));
    } finally { setBusy(false); }
  }

  async function recover(backup = false) {
    if (!await askDiscard()) return;
    setBusy(true);
    try {
      knifeTool?.cancel?.(true);
      if (editMode?.active) editMode.exit();
      await projects.recoverAutosave({ backup });
      resetHistory();
      hide();
    } finally { setBusy(false); }
  }

  async function deleteLocal(id) {
    if (!await ask(t('deleteTitle'), t('deleteText'), t('delete'))) return;
    await projects.deleteRecord?.(id);
    await refreshRecent();
  }

  async function refreshRecent() {
    const token = ++refreshToken;
    const host = root.querySelector('[data-home-recent]');
    if (!host) return;
    host.innerHTML = `<div class="home-loading">${esc(t('loading'))}</div>`;
    try {
      const records = await projects.listProjects();
      if (token !== refreshToken || !host.isConnected) return;
      if (!records.length) {
        host.innerHTML = `<div class="home-empty"><i data-lucide="folder-clock"></i><strong>${esc(t('noRecent'))}</strong><span>${esc(t('noRecentHint'))}</span></div>`;
        refreshIcons();
        return;
      }
      host.innerHTML = records.slice(0, 8).map((record, index) => {
        let metadata = {};
        try { metadata = projects.decodeProject(record.buffer)?.metadata ?? {}; } catch {}
        const integrity = metadata.integrity ?? {};
        const details = [
          Number.isFinite(integrity.meshes) ? `${integrity.meshes} ${t('meshes')}` : '',
          Number.isFinite(integrity.materials) ? `${integrity.materials} ${t('materials')}` : '',
          Number.isFinite(integrity.textures) ? `${integrity.textures} ${t('textures')}` : '',
          Number.isFinite(integrity.animations) && integrity.animations ? `${integrity.animations} ${t('animations')}` : '',
        ].filter(Boolean).join(' · ');
        return `<article class="home-project-card" data-project-id="${esc(record.id)}">
          <button type="button" class="home-project-main" data-home-open-local="${esc(record.id)}">
            <div class="home-project-preview">${wirePreview(index * 5 + (integrity.meshes ?? 0))}<span>${esc(details || 'gluestack')}</span></div>
            <div class="home-project-info"><strong>${esc(record.name || metadata.name || record.id)}</strong><span>${esc(formatDate(record.updatedAt, language()))}</span></div>
          </button>
          <div class="home-project-actions">
            <button type="button" data-home-open-local="${esc(record.id)}"><i data-lucide="folder-open"></i><span>${esc(t('open'))}</span></button>
            <button type="button" class="danger" data-home-delete-local="${esc(record.id)}" title="${esc(t('remove'))}"><i data-lucide="trash-2"></i></button>
          </div>
        </article>`;
      }).join('');
      refreshIcons();
    } catch (error) {
      host.innerHTML = `<div class="home-empty"><i data-lucide="triangle-alert"></i><strong>IndexedDB</strong><span>${esc(error.message || error)}</span></div>`;
      refreshIcons();
    }
  }

  async function refreshRecovery() {
    const host = root.querySelector('[data-home-recovery]');
    if (!host) return;
    const [current, backup] = await Promise.all([
      projects.getRecord(AUTOSAVE_ID).catch(() => null),
      projects.getRecord(AUTOSAVE_BACKUP_ID).catch(() => null),
    ]);
    const cards = [];
    if (current?.buffer) cards.push(recoveryCard(current, false));
    if (backup?.buffer) cards.push(recoveryCard(backup, true));
    host.innerHTML = cards.length ? cards.join('') : `<div class="home-empty compact"><i data-lucide="history"></i><strong>${esc(t('noAutosave'))}</strong></div>`;
    refreshIcons();
  }

  function recoveryCard(record, backup) {
    let metadata = {};
    try { metadata = projects.decodeProject(record.buffer)?.metadata ?? {}; } catch {}
    return `<button type="button" class="home-recovery-card" data-home-recover="${backup ? 'backup' : 'current'}">
      <span class="home-recovery-icon"><i data-lucide="${backup ? 'history-restore' : 'history'}"></i></span>
      <span><strong>${esc(backup ? t('backup') : t('currentAutosave'))}</strong><small>${esc(metadata.name || record.name || 'Untitled')} · ${esc(formatDate(record.updatedAt, language()))}</small></span>
      <i data-lucide="arrow-right"></i>
    </button>`;
  }

  function gpuName() {
    try {
      const gl = editor.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const value = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return String(value || 'WebGL').replace(/ANGLE \(/, '').replace(/\)$/,'').slice(0, 58);
    } catch { return 'WebGL'; }
  }

  function refreshSystem() {
    const host = root.querySelector('[data-home-system]');
    if (!host) return;
    const rows = [
      [t('webgl'), editor.renderer.capabilities?.isWebGL2 === false ? 'WebGL' : 'WebGL 2', true],
      [t('indexedDb'), 'indexedDB' in window ? 'OK' : '—', 'indexedDB' in window],
      [t('autosave'), settings.state.general.autosave ? t('enabled') : t('disabled'), settings.state.general.autosave],
      [t('gpu'), gpuName(), true],
      [t('version'), 'pre-1.0 · main', true],
    ];
    host.innerHTML = rows.map(([label, value, ok]) => `<div><span>${esc(label)}</span><strong class="${ok ? 'ok' : 'muted'}">${esc(value)}</strong></div>`).join('');
  }

  async function refresh() {
    await Promise.allSettled([refreshRecent(), refreshRecovery()]);
    refreshSystem();
  }

  function show() {
    visible = true;
    root.hidden = false;
    root.classList.add('is-visible');
    document.body.classList.add('gluestack-home-open');
    renderShell();
    refresh();
  }

  function hide() {
    visible = false;
    root.classList.remove('is-visible');
    root.hidden = true;
    document.body.classList.remove('gluestack-home-open');
    resolveConfirm(false);
    requestAnimationFrame(() => editor.resize());
  }

  function changeLanguage(next) {
    const select = settings.root?.querySelector?.('[data-setting="general.language"]');
    if (select) {
      select.value = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else i18n.setLanguage(next);
  }

  root.addEventListener('click', async (event) => {
    const confirmResult = event.target.closest?.('[data-home-confirm-result]');
    if (confirmResult) { resolveConfirm(confirmResult.dataset.homeConfirmResult === 'true'); return; }

    const languageButton = event.target.closest?.('[data-home-language]');
    if (languageButton) { changeLanguage(languageButton.dataset.homeLanguage); return; }

    const openLocalButton = event.target.closest?.('[data-home-open-local]');
    if (openLocalButton) { await openLocal(openLocalButton.dataset.homeOpenLocal); return; }

    const deleteButton = event.target.closest?.('[data-home-delete-local]');
    if (deleteButton) { await deleteLocal(deleteButton.dataset.homeDeleteLocal); return; }

    const recoverButton = event.target.closest?.('[data-home-recover]');
    if (recoverButton) { await recover(recoverButton.dataset.homeRecover === 'backup'); return; }

    const template = event.target.closest?.('[data-home-template]');
    if (template) { await createFromTemplate(template.dataset.homeTemplate); return; }

    const action = event.target.closest?.('[data-home-action]')?.dataset.homeAction;
    if (!action) return;
    if (action === 'new') await createFromTemplate('cube');
    else if (action === 'open-file') root.querySelector('[data-home-project-input]')?.click();
    else if (action === 'import') root.querySelector('[data-home-import-input]')?.click();
    else if (action === 'settings') settings.open();
    else if (action === 'refresh') await refresh();
    else if (action === 'lesson') {
      await createFromTemplate('cube');
      if (!editMode.active) editMode.enter();
      editMode.setSelectionMode('face');
      editor.events.onStatus(language() === 'ru' ? 'Урок: выберите грань → E → двигайте мышь → ЛКМ' : 'Lesson: select a face → E → move mouse → LMB');
    } else if (action === 'diagnostics') {
      hide();
      window.__gluestackFeatures?.releaseGate?.run?.();
    }
  });

  root.addEventListener('change', async (event) => {
    const projectInput = event.target.closest?.('[data-home-project-input]');
    if (projectInput) {
      const file = projectInput.files?.[0];
      if (!file) return;
      try {
        if (!await askDiscard()) return;
        setBusy(true);
        knifeTool?.cancel?.(true);
        if (editMode?.active) editMode.exit();
        await projects.openProjectBuffer(await file.arrayBuffer());
        resetHistory();
        hide();
      } catch (error) {
        console.error('[gluestack] home open failed', error);
        editor.events.onStatus(`Project: ${error.message || error}`);
      } finally { projectInput.value = ''; setBusy(false); }
      return;
    }

    const importInput = event.target.closest?.('[data-home-import-input]');
    if (importInput) {
      const files = [...(importInput.files ?? [])];
      if (!files.length) return;
      try {
        if (!await askDiscard()) return;
        setBusy(true);
        knifeTool?.cancel?.(true);
        if (editMode?.active) editMode.exit();
        await importer?.importFiles?.(files);
        projects.name = files.find((file) => /\.(?:glb|gltf)$/i.test(file.name))?.name.replace(/\.(?:glb|gltf)$/i, '') || 'Untitled';
        projects.setDirty(true, 'home-import');
        projects.scheduleAutosave();
        hide();
      } catch (error) {
        console.error('[gluestack] home import failed', error);
        editor.events.onStatus(`Import: ${error.message || error}`);
      } finally { importInput.value = ''; setBusy(false); }
    }
  });

  window.addEventListener('gluestack:language-changed', () => {
    if (!visible) return;
    renderShell();
    refresh();
  });
  window.addEventListener('gluestack:project-dirty', (event) => {
    if (visible && event.detail?.dirty === false) refreshRecent();
  });
  window.addEventListener('gluestack:settings-changed', () => { if (visible) refreshSystem(); });

  window.addEventListener('keydown', (event) => {
    if (!visible || root.hidden) return;
    if (!settings.root?.hidden) return;
    if (event.key === 'Escape' && confirmResolver) { resolveConfirm(false); event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    event.stopImmediatePropagation();
  }, { capture: true });

  const fileMenu = document.querySelector('#file-menu .menu-popover');
  if (fileMenu && !fileMenu.querySelector('[data-home-menu-open]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.homeMenuOpen = '';
    button.innerHTML = `<i data-lucide="house"></i><span>${esc(t('home'))}</span>`;
    const separator = document.createElement('div');
    separator.className = 'menu-separator';
    button.addEventListener('click', () => {
      document.querySelector('#file-menu')?.removeAttribute('open');
      show();
    });
    fileMenu.prepend(separator);
    fileMenu.prepend(button);
    window.addEventListener('gluestack:language-changed', () => {
      button.querySelector('span').textContent = t('home');
    });
  }

  const api = { root, show, hide, refresh, get visible() { return visible; } };
  window.__gluestackHome = api;
  show();
  return api;
}
