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
  const save = menuButton('save', 'save', 'Save Project…', 'Ctrl Shift S');
  const open = menuButton('open', 'folder-open', 'Open Project…');
  const saveLocal = menuButton('save-local', 'database', 'Save Local Snapshot…');
  const openLocal = menuButton('open-local', 'database-zap', 'Open Local Project…');
  const recover = menuButton('recover', 'history', 'Recover Autosave');
  menu.append(separator, save, open, saveLocal, openLocal, recover);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gluestack,application/octet-stream';
  input.hidden = true;
  document.body.appendChild(input);

  async function leaveEdit() {
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
  }

  async function run(action) {
    try {
      if (action === 'save') {
        const name = window.prompt('Project name', projects.name);
        if (name !== null) await projects.saveDownload(name);
      } else if (action === 'open') {
        input.click();
      } else if (action === 'save-local') {
        const name = window.prompt('Local project name', projects.name);
        if (name !== null) await projects.saveLocal(name);
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
      } else if (action === 'recover') {
        await leaveEdit();
        await projects.recoverAutosave();
      }
    } catch (error) {
      console.error(error);
      editor.events.onStatus(`Project: ${error.message || error}`);
    }
  }

  [save, open, saveLocal, openLocal, recover].forEach((button) => {
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
    } catch (error) {
      console.error(error);
      editor.events.onStatus(`Open project: ${error.message || error}`);
    } finally {
      input.value = '';
    }
  });

  const schedule = () => projects.scheduleAutosave();
  const previousStructure = editor.events.onStructure;
  editor.events.onStructure = (...args) => { previousStructure(...args); schedule(); };
  const previousTransform = editor.events.onTransform;
  editor.events.onTransform = (...args) => { previousTransform(...args); schedule(); };
  const previousHistory = editor.events.onHistory;
  editor.events.onHistory = (...args) => { previousHistory(...args); schedule(); };

  document.addEventListener('change', schedule, true);
  document.addEventListener('pointerup', (event) => {
    if (event.target.closest?.('#viewport, #uv-canvas, .properties-content')) schedule();
  }, true);
  window.addEventListener('beforeunload', () => {
    clearTimeout(projects.autosaveTimer);
  });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyS') {
      event.preventDefault();
      run('save');
    }
  }, { capture: true });

  refreshIcons();
  setTimeout(() => projects.scheduleAutosave(), 1000);
  return projects;
}
