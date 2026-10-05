const ICONS8_RENDERER = 'https://img.icons8.com/';
const ICONS8_CREDIT_URL = 'https://icons8.com/';

const TOOL_ICONS = Object.freeze([
  { selector: '[data-transform-mode="translate"]', id: '78763', name: 'Move' },
  { selector: '[data-transform-mode="rotate"]', id: '78525', name: '3D Rotate' },
  { selector: '[data-transform-mode="scale"]', id: '78731', name: 'Resize' },
  { selector: '[data-action="duplicate"]', id: '78580', name: 'Copy to Clipboard' },
  { selector: '[data-snap]', id: '79942', name: 'Magnet' },
  { selector: '[data-action="delete"], [data-action="edit-delete"]', id: '67884', name: 'Delete' },

  // Edit selection modes.
  { selector: '[data-edit-select-mode="vertex"]', id: '78599', name: 'Filled Circle' },
  { selector: '[data-edit-select-mode="edge"]', id: '78650', name: 'Line' },
  { selector: '[data-edit-select-mode="face"]', id: '123926', name: 'Square Border' },

  // Modeling tools. Icons are deliberately kept in one monochrome Icons8 family.
  { selector: '[data-action="edit-extrude"]', id: '78554', name: '3D Object' },
  { selector: '[data-action="edit-inset"]', id: '78886', name: 'Indent' },
  { selector: '[data-action="edit-bevel"]', id: '77809', name: 'Chamfer' },
  { selector: '[data-action="edit-loop-cut"]', id: '62915', name: 'Split' },
  { selector: '[data-action="edit-knife"]', id: '66808', name: 'Knife' },
  { selector: '[data-action="edit-merge"]', id: '62973', name: 'Merge' },
  { selector: '[data-action="edit-dissolve"]', id: '78647', name: 'Erase' },
  { selector: '[data-action="edit-fill"]', id: '78740', name: 'Fill Color' },

  // UV modal transforms use the same visual language as the 3D viewport.
  { selector: '[data-uv-action="move"]', id: '78763', name: 'Move' },
  { selector: '[data-uv-action="rotate"]', id: '78525', name: '3D Rotate' },
  { selector: '[data-uv-action="scale"]', id: '78731', name: 'Resize' },
]);

function rendererUrl(id, { size = 30, color = 'D0D0D0' } = {}) {
  const params = new URLSearchParams({ size: String(size), id: String(id), format: 'png', color });
  return `${ICONS8_RENDERER}?${params.toString()}`;
}

function sourceUrl(id, name = '') {
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://icons8.com/icon/${encodeURIComponent(id)}/${slug || 'icon'}`;
}

function currentLanguage() {
  return window.__gluestackI18n?.getLanguage?.() === 'en' ? 'en' : 'ru';
}

function ensureStyle() {
  if (document.querySelector('style[data-icons8-tools-style]')) return;
  const style = document.createElement('style');
  style.dataset.icons8ToolsStyle = '';
  style.textContent = `
    .icons8-tool-icon{width:17px;height:17px;object-fit:contain;display:block;pointer-events:none;opacity:.86;image-rendering:auto}
    .menu-popover .icons8-tool-icon{width:15px;height:15px;justify-self:center}
    .uv-action .icons8-tool-icon,.selection-mode-button .icons8-tool-icon{width:15px;height:15px}
    .icons8-tool-bound.icons8-tool-ready>svg,
    .icons8-tool-bound.icons8-tool-ready>i[data-lucide]{display:none!important}
    .tool-button.icons8-tool-ready:hover .icons8-tool-icon,
    .tool-button.icons8-tool-ready.active .icons8-tool-icon,
    .selection-mode-button.icons8-tool-ready.active .icons8-tool-icon{opacity:1;filter:brightness(1.18)}
    .tool-button.danger.icons8-tool-ready:hover .icons8-tool-icon{filter:sepia(1) saturate(5) hue-rotate(320deg) brightness(1.22)}
    .icons8-credit{margin-left:8px;color:var(--muted,#8e8e8e);font-size:9px;text-decoration:none;white-space:nowrap;opacity:.74}
    .icons8-credit:hover{color:var(--text,#ddd);opacity:1;text-decoration:underline}
    .home-footer .icons8-credit{margin-left:10px;color:#676767}
  `;
  document.head.appendChild(style);
}

function bindIcon(element, definition) {
  if (!(element instanceof HTMLElement)) return;
  const previous = element.querySelector(':scope > .icons8-tool-icon');
  if (previous?.dataset.icons8Id === String(definition.id)) return;
  previous?.remove();

  const img = document.createElement('img');
  img.className = 'icons8-tool-icon';
  img.dataset.icons8Id = String(definition.id);
  img.dataset.icons8Name = definition.name;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.decoding = 'async';
  img.loading = 'eager';
  img.referrerPolicy = 'no-referrer';
  img.src = rendererUrl(definition.id);
  img.title = `Icons8 · ${definition.name}`;

  element.classList.add('icons8-tool-bound');
  element.dataset.icons8Source = sourceUrl(definition.id, definition.name);
  img.addEventListener('load', () => {
    element.classList.add('icons8-tool-ready');
    element.classList.remove('icons8-tool-failed');
  }, { once: true });
  img.addEventListener('error', () => {
    element.classList.remove('icons8-tool-ready');
    element.classList.add('icons8-tool-failed');
    img.remove();
  }, { once: true });

  const fallback = element.querySelector(':scope > svg, :scope > i[data-lucide]');
  if (fallback) element.insertBefore(img, fallback);
  else element.prepend(img);
}

function scan(root = document) {
  for (const definition of TOOL_ICONS) {
    root.querySelectorAll?.(definition.selector).forEach((element) => bindIcon(element, definition));
    if (root.matches?.(definition.selector)) bindIcon(root, definition);
  }
}

function updateCreditText() {
  const ru = currentLanguage() === 'ru';
  document.querySelectorAll('.icons8-credit').forEach((credit) => {
    credit.textContent = ru ? 'Иконки: Icons8' : 'Icons by Icons8';
    credit.title = ru ? 'Иконки инструментов предоставлены Icons8' : 'Tool icons by Icons8';
  });
}

function ensureCredit() {
  let credit = document.querySelector('.icons8-credit[data-icons8-credit]');
  if (!credit) {
    credit = document.createElement('a');
    credit.className = 'icons8-credit';
    credit.dataset.icons8Credit = '';
    credit.href = ICONS8_CREDIT_URL;
    credit.target = '_blank';
    credit.rel = 'noreferrer';
    const status = document.querySelector('.status-bar');
    if (status) status.appendChild(credit);
  }

  const homeFooter = document.querySelector('.home-footer');
  if (homeFooter && !homeFooter.querySelector('[data-icons8-home-credit]')) {
    const link = credit.cloneNode(true);
    link.dataset.icons8HomeCredit = '';
    delete link.dataset.icons8Credit;
    homeFooter.appendChild(link);
  }
  updateCreditText();
}

export function installIcons8Tools() {
  if (window.__gluestackIcons8Tools) return window.__gluestackIcons8Tools;
  ensureStyle();
  scan(document);
  ensureCredit();

  let frame = 0;
  const observer = new MutationObserver((records) => {
    if (frame) return;
    const needsScan = records.some((record) => [...record.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE));
    if (!needsScan) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scan(document);
      ensureCredit();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('gluestack:language-changed', updateCreditText);

  const api = {
    source: 'Icons8',
    style: 'iOS Glyph',
    definitions: TOOL_ICONS,
    scan: () => scan(document),
    creditUrl: ICONS8_CREDIT_URL,
    dispose() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('gluestack:language-changed', updateCreditText);
    },
  };
  window.__gluestackIcons8Tools = api;
  return api;
}
