import { UVController } from './controller.js';

function button(action, icon, label) {
  return `<button type="button" class="uv-action" data-uv-action="${action}"><i data-lucide="${icon}"></i><span>${label}</span></button>`;
}

export function installUVWorkspace({ editor, editMode, knifeTool, setStatus, requestNumber, refreshIcons }) {
  const modelWorkspace = document.querySelector('main.workspace');
  const viewport = document.querySelector('#viewport');
  const originalViewportParent = viewport.parentElement;
  const uvTab = [...document.querySelectorAll('.workspace-tab')].find((item) => item.textContent.trim() === 'UV Editing');
  if (!modelWorkspace || !viewport || !uvTab) return null;

  modelWorkspace.id = 'model-workspace';
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './uv.css';
  document.head.appendChild(css);

  const workspace = document.createElement('main');
  workspace.id = 'uv-workspace';
  workspace.className = 'uv-workspace';
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="uv-editor-panel">
      <div class="uv-header">
        <span class="uv-header-title">UV Editor</span>
        <button type="button" class="uv-mode-button active" data-uv-mode="vertex" title="UV Vertex Select"><i data-lucide="circle-dot"></i></button>
        <button type="button" class="uv-mode-button" data-uv-mode="edge" title="UV Edge Select"><i data-lucide="minus"></i></button>
        <button type="button" class="uv-mode-button" data-uv-mode="island" title="UV Island Select"><i data-lucide="shapes"></i></button>
        <div class="uv-header-spacer"></div>
        <button type="button" class="uv-icon-button" data-uv-action="fit" title="Fit 0..1"><i data-lucide="focus"></i></button>
      </div>
      <div class="uv-canvas-wrap"><canvas id="uv-canvas"></canvas></div>
      <div id="uv-info" class="uv-info">No mesh</div>
    </section>
    <section class="uv-preview-panel">
      <div class="uv-header"><span class="uv-header-title">3D Viewport</span><div class="uv-header-spacer"></div><span>MMB orbit · Wheel zoom</span></div>
      <div id="uv-preview-host" class="uv-preview-host"></div>
    </section>
    <aside class="uv-tools-panel">
      <div class="uv-tools-section">
        <h3>Unwrap</h3>
        <div class="uv-action-grid one">
          ${button('unwrap', 'unfold-vertical', 'Unwrap from Seams')}
          ${button('smart', 'wand-sparkles', 'Smart UV Project')}
        </div>
      </div>
      <div class="uv-tools-section">
        <h3>Projection</h3>
        <div class="uv-action-grid">
          ${button('cube', 'box', 'Cube')}
          ${button('cylinder', 'cylinder', 'Cylinder')}
          ${button('sphere', 'circle', 'Sphere')}
          ${button('view', 'scan', 'From View')}
        </div>
      </div>
      <div class="uv-tools-section">
        <h3>Islands</h3>
        <div class="uv-action-grid one">
          ${button('pack', 'layout-grid', 'Pack Islands')}
          ${button('average', 'scale', 'Average Island Scale')}
          ${button('clear-seams', 'eraser', 'Clear Seams')}
        </div>
      </div>
      <div class="uv-tools-section">
        <h3>Transform</h3>
        <div class="uv-action-grid">
          ${button('move', 'move', 'Move')}
          ${button('rotate', 'rotate-cw', 'Rotate')}
          ${button('scale', 'maximize-2', 'Scale')}
        </div>
      </div>
      <div class="uv-tools-section">
        <h3>Reference Texture</h3>
        <input id="uv-reference-file" class="uv-file" type="file" accept="image/png,image/jpeg,image/webp" />
      </div>
    </aside>`;
  modelWorkspace.insertAdjacentElement('afterend', workspace);

  uvTab.disabled = false;
  uvTab.removeAttribute('title');
  uvTab.dataset.workspace = 'uv';

  const controller = new UVController(editor, {
    canvas: workspace.querySelector('#uv-canvas'),
    info: workspace.querySelector('#uv-info'),
  }, setStatus);
  const previewHost = workspace.querySelector('#uv-preview-host');
  let active = false;

  function enter() {
    knifeTool.cancel(true);
    if (editMode.active) editMode.exit();
    if (!editor.selected?.isMesh) {
      setStatus('UV Editing: выберите Mesh в Layout');
      document.querySelector('[data-workspace="layout"]')?.click();
      return false;
    }
    modelWorkspace.hidden = true;
    workspace.hidden = false;
    previewHost.appendChild(viewport);
    active = true;
    controller.open(editor.selected);
    requestAnimationFrame(() => {
      editor.resize();
      controller.resize();
      refreshIcons();
    });
    return true;
  }

  function leave() {
    if (!active) return;
    originalViewportParent.appendChild(viewport);
    workspace.hidden = true;
    modelWorkspace.hidden = false;
    active = false;
    controller.close();
    requestAnimationFrame(() => editor.resize());
  }

  document.querySelector('.workspace-tabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('.workspace-tab');
    if (!tab || tab.disabled) return;
    if (tab.dataset.workspace === 'uv') enter();
    else leave();
  }, { capture: true });

  workspace.querySelectorAll('[data-uv-mode]').forEach((item) => {
    item.addEventListener('click', () => {
      controller.setMode(item.dataset.uvMode);
      workspace.querySelectorAll('[data-uv-mode]').forEach((candidate) => candidate.classList.toggle('active', candidate === item));
    });
  });

  function number(label, value, options) {
    return requestNumber(label, value, options);
  }

  workspace.querySelectorAll('[data-uv-action]').forEach((item) => {
    item.addEventListener('click', () => {
      switch (item.dataset.uvAction) {
        case 'fit': controller.fit(); break;
        case 'unwrap': controller.unwrap(); break;
        case 'smart': controller.smartProject(); break;
        case 'cube': controller.projectCube(); break;
        case 'cylinder': controller.projectCylinder(); break;
        case 'sphere': controller.projectSphere(); break;
        case 'view': controller.projectFromView(); break;
        case 'pack': controller.packIslands(); break;
        case 'average': controller.averageIslandScale(); break;
        case 'clear-seams': controller.clearSeams(); break;
        case 'move': {
          const x = number('UV Move X', 0.1); if (x === null) break;
          const y = number('UV Move Y', 0); if (y !== null) controller.moveSelected(x, y);
          break;
        }
        case 'rotate': {
          const angle = number('UV Rotate degrees', 90); if (angle !== null) controller.rotateSelected(angle);
          break;
        }
        case 'scale': {
          const factor = number('UV Scale', 1.1, { min: 0.001 }); if (factor !== null) controller.scaleSelected(factor);
          break;
        }
        default: break;
      }
    });
  });

  workspace.querySelector('#uv-reference-file').addEventListener('change', (event) => {
    controller.loadTexture(event.target.files?.[0] ?? null);
  });

  const meshMenu = document.querySelector('#mesh-menu .menu-popover');
  if (meshMenu && !meshMenu.querySelector('[data-uv-mark-seam]')) {
    const separator = document.createElement('div');
    separator.className = 'menu-separator';
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.dataset.uvMarkSeam = '';
    mark.innerHTML = '<i data-lucide="scissors-line-dashed"></i><span>Mark UV Seam</span><kbd>Edge Select</kbd>';
    mark.addEventListener('click', () => {
      controller.mesh = editMode.mesh;
      controller.loadSeams();
      controller.markSeamsFromEditMode(editMode);
    });
    meshMenu.append(separator, mark);
  }

  window.addEventListener('keydown', (event) => {
    if (!active || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === 'Digit1') { event.preventDefault(); workspace.querySelector('[data-uv-mode="vertex"]').click(); }
    else if (event.code === 'Digit2') { event.preventDefault(); workspace.querySelector('[data-uv-mode="edge"]').click(); }
    else if (event.code === 'Digit3') { event.preventDefault(); workspace.querySelector('[data-uv-mode="island"]').click(); }
    else if (event.code === 'KeyA') {
      event.preventDefault();
      controller.selected.clear();
      if (controller.mode === 'vertex') {
        const uv = controller.mesh?.geometry.getAttribute('uv');
        for (let i = 0; i < (uv?.count ?? 0); i += 1) controller.selected.add(i);
      } else if (controller.mode === 'island') controller.islands.forEach((island) => controller.selected.add(island.id));
      else controller.triangles.forEach((triangle) => {
        for (let i = 0; i < 3; i += 1) controller.selected.add(`${Math.min(triangle.corners[i], triangle.corners[(i + 1) % 3])}|${Math.max(triangle.corners[i], triangle.corners[(i + 1) % 3])}`);
      });
      controller.render(); controller.updateInfo();
    }
  }, { capture: true });

  refreshIcons();
  return { controller, enter, leave, get active() { return active; } };
}
