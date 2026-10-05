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

  function updateLabels() {
    const returnButton = home.root.querySelector('[data-home-return]');
    if (returnButton) {
      returnButton.title = returnLabel();
      const text = returnButton.querySelector('span');
      if (text) text.textContent = returnLabel();
    }

    const portfolio = home.root.querySelector('[data-home-portfolio]');
    if (portfolio) {
      portfolio.title = portfolioLabel();
      portfolio.setAttribute('aria-label', portfolioLabel());
    }
  }

  function mount() {
    const actions = home.root.querySelector('.home-top-actions');
    if (!actions) return;

    if (!actions.querySelector('[data-home-return]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'home-return-button';
      button.dataset.homeReturn = '';
      button.innerHTML = `<i data-lucide="arrow-left"></i><span>${returnLabel()}</span>`;
      button.addEventListener('click', () => home.hide());
      actions.prepend(button);
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
    }

    updateLabels();
    refreshIcons();
  }

  const observer = new MutationObserver(() => queueMicrotask(mount));
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
