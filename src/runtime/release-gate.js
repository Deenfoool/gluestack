import { refreshIcons } from '../ui.js';

function normalizedRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

function normalizeRow(suite, item, index) {
  const ok = item?.ok !== false && item?.level !== 'fail';
  const level = item?.level === 'warn' ? 'warn' : ok ? 'pass' : 'fail';
  return {
    suite,
    name: item?.name || `Check ${index + 1}`,
    detail: item?.detail || '',
    ok,
    level,
  };
}

export function installReleaseGate({
  editor,
  diagnostics,
  transformIntegrity,
  metadataAudit,
  goldenDiagnostics,
  uvGoldenDiagnostics,
  modifierStackDiagnostics,
  importExportDiagnostics,
  destructiveGuardDiagnostics,
}) {
  if (!editor || !diagnostics || editor.__gluestackReleaseGate) return editor?.__gluestackReleaseGate ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.releaseGate = '';
  button.innerHTML = '<i data-lucide="badge-check"></i><span>Run v1 Release Gate</span>';
  menu.prepend(separator);
  menu.prepend(button);

  const suites = [
    ['Core Diagnostics', diagnostics],
    ['Transform Integrity', transformIntegrity],
    ['Metadata Audit', metadataAudit],
    ['Golden Fixtures', goldenDiagnostics],
    ['UV Golden', uvGoldenDiagnostics],
    ['Modifier Stack', modifierStackDiagnostics],
    ['Import / Export', importExportDiagnostics],
    ['Data Guards', destructiveGuardDiagnostics],
  ];

  async function runSuite(label, api) {
    if (!api?.run) {
      return [{ suite: label, name: 'Suite available', detail: 'suite did not install', ok: false, level: 'fail' }];
    }
    try {
      const raw = await api.run();
      const rows = normalizedRows(raw);
      if (!rows.length) {
        return [{ suite: label, name: 'Suite result', detail: 'suite returned no check rows', ok: false, level: 'fail' }];
      }
      return rows.map((item, index) => normalizeRow(label, item, index));
    } catch (error) {
      return [{ suite: label, name: 'Suite execution', detail: error.message || String(error), ok: false, level: 'fail' }];
    }
  }

  function render(rows, elapsedMs) {
    const overlay = diagnostics.overlay;
    const container = overlay?.querySelector('[data-diagnostics-results]');
    const summary = overlay?.querySelector('[data-diagnostics-summary]');
    if (!overlay || !container || !summary) return;

    const failed = rows.filter((row) => row.level === 'fail').length;
    const warned = rows.filter((row) => row.level === 'warn').length;
    const passed = rows.filter((row) => row.level === 'pass').length;
    overlay.hidden = false;
    summary.textContent = failed
      ? `v1 Release Gate · ${failed} FAIL · ${warned} WARN · ${passed} PASS · ${(elapsedMs / 1000).toFixed(1)}s`
      : `v1 Release Gate · PASS · ${warned} WARN · ${passed} checks · ${(elapsedMs / 1000).toFixed(1)}s`;
    container.replaceChildren();

    let previousSuite = '';
    for (const rowData of rows) {
      if (rowData.suite !== previousSuite) {
        previousSuite = rowData.suite;
        const heading = document.createElement('div');
        heading.className = 'release-gate-suite-heading';
        heading.textContent = rowData.suite;
        container.appendChild(heading);
      }
      const row = document.createElement('div');
      row.className = `diagnostics-row ${rowData.level}`;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = rowData.level === 'warn' ? 'WARN' : rowData.ok ? 'PASS' : 'FAIL';
      const name = document.createElement('strong');
      name.textContent = rowData.name;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = rowData.detail;
      row.append(badge, name, detail);
      container.appendChild(row);
    }
  }

  async function run() {
    button.disabled = true;
    diagnostics.menu?.removeAttribute('open');
    editor.events.onStatus('v1 Release Gate: running…');
    const started = performance.now();
    const rows = [];
    try {
      for (const [label, api] of suites) {
        editor.events.onStatus(`v1 Release Gate · ${label}…`);
        rows.push(...await runSuite(label, api));
      }
      const elapsedMs = performance.now() - started;
      render(rows, elapsedMs);
      const failed = rows.filter((row) => row.level === 'fail').length;
      const warned = rows.filter((row) => row.level === 'warn').length;
      console.groupCollapsed('[gluestack] v1 Release Gate');
      console.table(rows.map((row) => ({ suite: row.suite, status: row.level.toUpperCase(), check: row.name, detail: row.detail })));
      console.groupEnd();
      editor.events.onStatus(failed ? `v1 Release Gate: ${failed} FAIL · ${warned} WARN` : `v1 Release Gate: PASS · ${warned} WARN`);
      window.__gluestackLastReleaseGate = { at: new Date().toISOString(), elapsedMs, rows };
      return rows;
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', run);
  const style = document.createElement('style');
  style.textContent = '.release-gate-suite-heading{margin:8px 0 2px;padding:5px 7px;background:#2b2b2b;border-left:3px solid #6f8fbf;color:#d7d7d7;font-weight:600;font-size:11px}.release-gate-suite-heading:first-child{margin-top:0}';
  document.head.appendChild(style);

  const api = { button, run };
  editor.__gluestackReleaseGate = api;
  window.__gluestackReleaseGate = api;
  refreshIcons();
  return api;
}
