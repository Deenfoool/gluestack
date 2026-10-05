import { refreshIcons } from '../ui.js';

export function installHomeReturn({ home, i18n }) {
  if (!home?.root) return null;

  const style = document.createElement('style');
  style.textContent = `
    .home-return-button{height:31px;border:1px solid #303030;background:#202020;color:#aaa;border-radius:7px;padding:0 10px;display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:10px;cursor:pointer;white-space:nowrap}
    .home-return-button:hover{background:#292929;border-color:#484848;color:#fff}
    .home-return-button svg{width:13px;height:13px}
    @media(max-width:620px){.home-return-button span{display:none}.home-return-button{width:31px;padding:0;justify-content:center}}
  `;
  document.head.appendChild(style);

  function label() {
    return i18n?.getLanguage?.() === 'en' ? 'Back to Editor' : 'В редактор';
  }

  function mount() {
    const actions = home.root.querySelector('.home-top-actions');
    if (!actions || actions.querySelector('[data-home-return]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-return-button';
    button.dataset.homeReturn = '';
    button.title = label();
    button.innerHTML = `<i data-lucide="arrow-left"></i><span>${label()}</span>`;
    button.addEventListener('click', () => home.hide());
    actions.prepend(button);
    refreshIcons();
  }

  const observer = new MutationObserver(() => queueMicrotask(mount));
  observer.observe(home.root, { childList: true, subtree: true });
  window.addEventListener('gluestack:language-changed', mount);
  mount();

  return { mount, dispose() { observer.disconnect(); style.remove(); } };
}
