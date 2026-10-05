import { ProjectController } from './controller.js';
import { refreshIcons } from '../ui.js';

function menuButton(action, icon, label, shortcut = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.projectAction = action;
  button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}`;
  return button;
}

export function installProjects({ editor, editMode, knifeTool }) {
  const projects = new ProjectController(editor);
  const menu = document.querySelector('#file-menu .menu-popover');
  if (!menu) return projects;

  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  const save = menuButton('save', 'save', 'Save Project', 'Ctrl S');
  const saveAs = menuButton('save-as', 'download', 'Save Project As…', 'Ctrl Shift S');
  const open = menuButton('open', 'folder-open', 'Open Project…');
  const openLocal = menuButton('open-local', 'database-zap', 'Open Local Project…');
  const recover = menuButton('recover', 'history', 'Recover Autosave');
  const recoverBackup = menuButton('recover-backup', 'history-restore', 'Recover Previous Autosave');
  menu.append(separator, save, saveAs, open, openLocal, recover, recoverBackup);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gluestack,application/octet-stream';
  input.hidden = true;
  document.body.appendChild(input);

  const baseTitle = document.title.replace(/^\*\s*/, '');
  const menuBar = document.querySelector('.main-menu-bar');
  const buildLabel = menuBar?.querySelector('.build-label');
  const dirtyIndicator = document.createElement('span');
  dirtyIndicator.className = 'project-dirty-indicator';
  dirtyIndicator.title = 'Есть несохранённые изменения';
  dirtyIndicator.hidden = true;
  dirtyIndicator.textContent = '● Unsaved';
  if (menuBar) menuBar.insertBefore(dirtyIndicator, buildLabel ?? null);

  const style = document.createElement('style');
  style.textContent = `
    .project-dirty-indicator{font-size:10px;color:#e1a14a;padding:2px 6px;border:1px solid rgba(225,161,74,.35);border-radius:3px;background:rgba(225,161,74,.08);white-space:nowrap}
    .project-dirty-indicator[hidden]{display:none}`;
  document.head.appendChild(style);

  function updateDirtyUI() {
    dirtyIndicator.hidden = !projects.dirty;
    document.title = projects.dirty ? `* ${baseTitle}` : baseTitle;
  }

  window.addEventListener('gluestack:project-dirty', updateDirtyUI);
  updateDirtyUI();

  async function leaveEdit() {
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
  }

  function resetHistory() {
    const previousLoading = projects.isLoading;
    projects.isLoading = true;
    try {
      editor.cancelHistory();
      editor.clearHistoryStack(editor.undoStack);
      editor.clearHistoryStack(editor.redoStack);
      editor.emitHistory();
    } finally {
      projects.isLoading = previousLoading;
    }
  }

  async function quickSave() {
    let name = projects.name;
    if (!name || name === 'Untitled') {
      const answer = window.prompt('Project name', name || 'Untitled');
      if (answer === null) return false;
      name = answer;
    }
    await projects.saveLocal(name);
    updateDirtyUI();
    return true;
  }

  async function saveAsDownload() {
    const answer = window.prompt('Project name', projects.name || 'Untitled');
    if (answer === null) return false;
    await projects.saveDownload(answer);
    updateDirtyUI();
    return true;
  }

  async function run(action) {
    try {
      if (action === 'save') {
        await quickSave();
      } else if (action === 'save-as') {
        await saveAsDownload();
      } else if (action === 'open') {
        input.click();
      } else if (action === 'open-local') {
        const list = await projects.listProjects();
        if (!list.length) throw new Error('Локальных проектов пока нет');
        const names = list.map((item, index) => `${index + 1}. ${item.name} — ${new Date(item.updatedAt).toLocaleString()}`).join('\n');
        const answer = window.prompt(`Выберите номер проекта:\n\n${names}`, '1');
        if (answer === null) return;
        const index = Number(answer) - 1;
        if (!Number.isInteger(index) || !list[index]) throw new Error('Некорректный номер проекта');
        await leaveEdit();
        await projects.openLocal(list[index].id);
        resetHistory();
        updateDirtyUI();
      } else if (action === 'recover' || action === 'recover-backup') {
        await leaveEdit();
        await projects.recoverAutosave({ backup: action === 'recover-backup' });
        resetHistory();
        updateDirtyUI();
      }
    } catch (error) {
      console.error(error);
      editor.events.onStatus(`Project: ${error.message || error}`);
    }
  }

  [save, saveAs, open, openLocal, recover, recoverBackup].forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('#file-menu')?.removeAttribute('open');
      run(button.dataset.projectAction);
    });
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await leaveEdit();
      await projects.openProjectBuffer(await file.arrayBuffer());
      resetHistory();
      updateDirtyUI();
    } catch (error) {
      console.error(error);
      editor.events.onStatus(`Open project: ${error.message || error}`);
    } finally {
      input.value = '';
    }
  });

  const schedule = (reason = 'change') => {
    projects.markDirty(reason);
    projects.scheduleAutosave();
    updateDirtyUI();
  };

  const previousStructure = editor.events.onStructure;
  editor.events.onStructure = (...args) => { previousStructure(...args); schedule('structure'); };
  const previousTransform = editor.events.onTransform;
  editor.events.onTransform = (...args) => { previousTransform(...args); schedule('transform'); };
  const previousHistory = editor.events.onHistory;
  editor.events.onHistory = (...args) => { previousHistory(...args); schedule('history'); };
  const previousSelection = editor.events.onSelection;
  editor.events.onSelection = (...args) => { previousSelection(...args); schedule('selection'); };

  document.addEventListener('change', (event) => {
    if (event.target === input) return;
    if (event.target.closest?.('[data-gluestack-settings]')) return;
    schedule('ui-change');
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (event.target.closest?.('#viewport, #uv-canvas')) schedule('viewport');
  }, true);

  window.addEventListener('beforeunload', (event) => {
    clearTimeout(projects.autosaveTimer);
    if (!projects.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.code !== 'KeyS') return;
    event.preventDefault();
    if (event.shiftKey) run('save-as');
    else run('save');
  }, { capture: true });

  refreshIcons();
  return projects;
}
