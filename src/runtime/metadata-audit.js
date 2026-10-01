import { auditRootUserData } from './metadata-policy.js';
import { refreshIcons } from '../ui.js';

function parseGlb(editor, buffer) {
  return new Promise((resolve, reject) => {
    editor.loader.parse(buffer, '', resolve, (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

function row(name, ok, detail) {
  return { name, ok, detail, level: ok ? 'pass' : 'fail' };
}

export function installMetadataAudit({ editor, projects, diagnostics }) {
  if (!editor || !projects || !diagnostics || editor.__gluestackMetadataAudit) return editor?.__gluestackMetadataAudit ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<i data-lucide="shield-check"></i><span>Audit Metadata</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    editor.events.onStatus('Metadata Audit: running…');
    try {
      const live = auditRootUserData(editor.modelRoot);
      const projectBuffer = await projects.encodeProject();
      const decoded = projects.decodeProject(projectBuffer);
      const projectGltf = await parseGlb(editor, decoded.glb);
      const projectAudit = auditRootUserData(projectGltf.scene);
      const cleanBuffer = await editor.exportCleanBuffer();
      const cleanGltf = await parseGlb(editor, cleanBuffer);
      const cleanAudit = auditRootUserData(cleanGltf.scene);

      const results = [
        row('Live metadata policy', true, `runtime ${live.counts.runtime} · editor ${live.counts.editor} · transient ${live.counts.transient}`),
        row('Project transient metadata', projectAudit.counts.transient === 0, `transient keys ${projectAudit.counts.transient}`),
        row('Project editor metadata', projectAudit.counts.editor >= 0, `editor keys ${projectAudit.counts.editor} · runtime extras ${projectAudit.counts.runtime}`),
        row('Clean GLB editor metadata', cleanAudit.counts.editor === 0 && cleanAudit.counts.transient === 0, `editor ${cleanAudit.counts.editor} · transient ${cleanAudit.counts.transient}`),
      ];

      const overlay = diagnostics.overlay;
      const container = overlay?.querySelector('[data-diagnostics-results]');
      const summary = overlay?.querySelector('[data-diagnostics-summary]');
      if (overlay && container && summary) {
        overlay.hidden = false;
        const failed = results.filter((item) => !item.ok).length;
        summary.textContent = failed ? `Metadata Audit · ${failed} failed` : 'Metadata Audit · PASS';
        container.replaceChildren();
        for (const item of results) {
          const entry = document.createElement('div');
          entry.className = `diagnostics-row ${item.level}`;
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = item.ok ? 'PASS' : 'FAIL';
          const title = document.createElement('strong');
          title.textContent = item.name;
          const detail = document.createElement('span');
          detail.className = 'detail';
          detail.textContent = item.detail;
          entry.append(badge, title, detail);
          container.appendChild(entry);
        }
      }
      console.groupCollapsed('[gluestack] Metadata Audit');
      console.log('live', live);
      console.log('project', projectAudit);
      console.log('clean', cleanAudit);
      console.table(results);
      console.groupEnd();
      const failed = results.filter((item) => !item.ok).length;
      editor.events.onStatus(failed ? `Metadata Audit: ${failed} FAIL` : 'Metadata Audit: PASS');
      return { results, live, project: projectAudit, clean: cleanAudit };
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run().catch((error) => {
      console.error('[gluestack] metadata audit failed', error);
      editor.events.onStatus(`Metadata Audit: ${error.message || error}`);
    });
  });

  const api = { button, run };
  editor.__gluestackMetadataAudit = api;
  refreshIcons();
  return api;
}
