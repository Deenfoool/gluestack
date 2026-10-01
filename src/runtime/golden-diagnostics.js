import { refreshIcons } from '../ui.js';

export function installGoldenDiagnostics({ editor, diagnostics }) {
  if (!editor || !diagnostics || editor.__gluestackGoldenDiagnostics) return editor?.__gluestackGoldenDiagnostics ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.goldenFixtures = '';
  button.innerHTML = '<i data-lucide="flask-conical"></i><span>Run Golden Fixtures</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    editor.events.onStatus('Golden fixtures: running…');
    try {
      const { runGoldenFixtures } = await import('../../tests/fixtures/golden-fixtures.js');
      const results = await runGoldenFixtures(editor);
      const failed = results.filter((item) => !item.ok);
      console.table(results.map((item) => ({ status: item.ok ? 'PASS' : 'FAIL', ...item })));
      editor.events.onStatus(failed.length ? `Golden fixtures: ${failed.length} FAIL` : `Golden fixtures: PASS · ${results.length}/${results.length}`);

      const overlay = diagnostics.overlay;
      const container = overlay?.querySelector('[data-diagnostics-results]');
      const summary = overlay?.querySelector('[data-diagnostics-summary]');
      if (overlay && container && summary) {
        overlay.hidden = false;
        summary.textContent = failed.length ? `Golden fixtures · ${failed.length} failed` : `Golden fixtures · ${results.length}/${results.length} passed`;
        container.replaceChildren();
        for (const item of results) {
          const row = document.createElement('div');
          row.className = `diagnostics-row ${item.ok ? 'pass' : 'fail'}`;
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = item.ok ? 'PASS' : 'FAIL';
          const name = document.createElement('strong');
          name.textContent = item.name;
          const detail = document.createElement('span');
          detail.className = 'detail';
          detail.textContent = item.detail;
          row.append(badge, name, detail);
          container.appendChild(row);
        }
      }
      return results;
    } catch (error) {
      console.error('[gluestack] golden fixtures failed', error);
      editor.events.onStatus(`Golden fixtures: ${error.message || error}`);
      return [{ name: 'fixture runner', ok: false, detail: error.message || String(error) }];
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run();
  });

  const api = { button, run };
  editor.__gluestackGoldenDiagnostics = api;
  window.__gluestackGoldenFixtures = api;
  refreshIcons();
  return api;
}
