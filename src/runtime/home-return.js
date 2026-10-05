import { refreshIcons } from '../ui.js';

const PORTFOLIO_URL = 'https://deenfoool.github.io/portfolio/';

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

  function isEnglish() {
    return i18n?.getLanguage?.() === 'en';
  }

  function returnLabel() {
    return isEnglish() ? 'Back to Editor' : 'В редактор';
  }

  function portfolioLabel() {
    return isEnglish() ? 'Portfolio' : 'Портфолио';
  }

  function setTextIfChanged(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function setAttributeIfChanged(element, name, value) {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function updateLabels() {
    const returnButton = home.root.querySelector('[data-home-return]');
    if (returnButton) {
      const label = returnLabel();
      setAttributeIfChanged(returnButton, 'title', label);
      setTextIfChanged(returnButton.querySelector('span'), label);
    }

    const portfolio = home.root.querySelector('[data-home-portfolio]');
    if (portfolio) {
      const label = portfolioLabel();
      setAttributeIfChanged(portfolio, 'title', label);
      setAttributeIfChanged(portfolio, 'aria-label', label);
    }
  }

  function mount() {
    const actions = home.root.querySelector('.home-top-actions');
    if (!actions) return false;

    let changed = false;

    if (!actions.querySelector('[data-home-return]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'home-return-button';
      button.dataset.homeReturn = '';
      button.innerHTML = `<i data-lucide="arrow-left"></i><span>${returnLabel()}</span>`;
      button.addEventListener('click', () => home.hide());
      actions.prepend(button);
      changed = true;
    }

    if (!actions.querySelector('[data-home-portfolio]')) {
      const portfolio = document.createElement('a');
      portfolio.className = 'home-icon-button';
      portfolio.dataset.homePortfolio = '';
      portfolio.href = PORTFOLIO_URL;
      portfolio.target = '_blank';
      portfolio.rel = 'noopener noreferrer';
      portfolio.innerHTML = '<i data-lucide="briefcase-business"></i>';

      const github = [...actions.querySelectorAll('a')]
        .find((link) => link.href.includes('github.com/Deenfoool/gluestack'));
      if (github) actions.insertBefore(portfolio, github);
      else actions.appendChild(portfolio);
      changed = true;
    }

    updateLabels();

    // createIcons() mutates DOM. Calling it unconditionally from a MutationObserver
    // creates a feedback loop: observer -> mount -> refreshIcons -> DOM mutation -> observer.
    // Only refresh when this function actually inserted fresh icon placeholders.
    if (changed) refreshIcons();
    return changed;
  }

  let scheduled = false;
  const observer = new MutationObserver((records) => {
    // Home renderShell() replaces its contents wholesale. We only need to remount
    // when a newly-added subtree may contain the top action bar. Ignore Lucide's
    // internal SVG mutations and our own already-mounted controls.
    const relevant = records.some((record) => [...record.addedNodes].some((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.('.home-top-actions, .home-shell, header, div')
        && (node.matches?.('.home-top-actions') || node.querySelector?.('.home-top-actions'));
    }));
    if (!relevant || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      mount();
    });
  });

  observer.observe(home.root, { childList: true, subtree: true });
  window.addEventListener('gluestack:language-changed', updateLabels);
  mount();

  return {
    mount,
    dispose() {
      observer.disconnect();
      window.removeEventListener('gluestack:language-changed', updateLabels);
      style.remove();
    },
  };
}
