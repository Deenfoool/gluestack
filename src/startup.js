// Catch both module download failures and synchronous editor construction
// errors. Neither should leave an inaccessible, permanently busy Home screen.
import('./main.js').catch((error) => {
  console.error('[gluestack] startup failed', error);
  const root = document.querySelector('#gluestack-home-startup');
  if (!root) return;
  root.setAttribute('aria-busy', 'false');
  const status = root.querySelector('.home-startup-status');
  if (status) status.textContent = 'Не удалось запустить редактор';
  const message = root.querySelector('.home-loading');
  if (message) {
    const webgl = /WebGL|context/i.test(error?.message ?? '');
    message.textContent = webgl
      ? 'Браузер не смог запустить WebGL. Проверь аппаратное ускорение в настройках браузера и перезапусти его.'
      : 'Не удалось загрузить редактор. Проверь соединение и попробуй открыть сайт снова.';
    message.setAttribute('role', 'alert');
  }
  const actions = root.querySelector('.home-primary-actions');
  if (actions) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'home-button primary';
    retry.textContent = 'Повторить запуск';
    retry.addEventListener('click', () => window.location.reload());
    actions.replaceChildren(retry);
  }
});
