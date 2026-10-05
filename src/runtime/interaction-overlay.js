const STYLE_ID = 'gluestack-interaction-overlay-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .gluestack-interaction-overlay {
      position: fixed;
      inset: 0;
      z-index: 100000;
      pointer-events: none;
      overflow: hidden;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .gluestack-interaction-overlay[hidden] { display: none !important; }
    .gluestack-interaction-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .gluestack-interaction-card {
      position: fixed;
      min-width: 154px;
      max-width: 290px;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 7px;
      background: rgba(25,25,25,.94);
      box-shadow: 0 8px 24px rgba(0,0,0,.38);
      color: #e7e7e7;
      backdrop-filter: blur(7px);
      transform: translate(16px, 18px);
      white-space: nowrap;
    }
    .gluestack-interaction-title {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #f3f3f3;
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
    }
    .gluestack-interaction-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #f59b23;
      box-shadow: 0 0 0 3px rgba(245,155,35,.14);
      flex: none;
    }
    .gluestack-interaction-value {
      margin-top: 5px;
      color: #ffb554;
      font: 600 13px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .gluestack-interaction-hint {
      margin-top: 4px;
      color: #a9a9a9;
      font-size: 10px;
      line-height: 1.3;
    }
  `;
  document.head.appendChild(style);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}

export class InteractionOverlay {
  constructor() {
    ensureStyles();
    this.root = document.createElement('div');
    this.root.className = 'gluestack-interaction-overlay';
    this.root.hidden = true;
    this.root.innerHTML = `
      <svg class="gluestack-interaction-svg" aria-hidden="true"></svg>
      <div class="gluestack-interaction-card">
        <div class="gluestack-interaction-title"><span class="gluestack-interaction-dot"></span><span data-title></span></div>
        <div class="gluestack-interaction-value" data-value></div>
        <div class="gluestack-interaction-hint" data-hint></div>
      </div>`;
    document.body.appendChild(this.root);
    this.svg = this.root.querySelector('svg');
    this.card = this.root.querySelector('.gluestack-interaction-card');
    this.title = this.root.querySelector('[data-title]');
    this.value = this.root.querySelector('[data-value]');
    this.hint = this.root.querySelector('[data-hint]');
  }

  show({ x = 0, y = 0, title = '', value = '', hint = '', svg = '' } = {}) {
    this.root.hidden = false;
    const margin = 12;
    const cardWidth = 290;
    const cardHeight = 82;
    const left = Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - cardWidth - 28));
    const top = Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - cardHeight - 30));
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
    this.title.textContent = title;
    this.value.textContent = value;
    this.hint.textContent = hint;
    this.svg.innerHTML = svg;
  }

  hide() {
    this.root.hidden = true;
    this.svg.innerHTML = '';
  }

  dispose() {
    this.root.remove();
  }
}

export function line(x1, y1, x2, y2, { color = '#f59b23', width = 1.5, opacity = 0.7, dash = '' } = {}) {
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${esc(color)}" stroke-width="${width}" stroke-opacity="${opacity}"${dash ? ` stroke-dasharray="${esc(dash)}"` : ''} vector-effect="non-scaling-stroke" />`;
}

export function circle(x, y, { radius = 4, color = '#f59b23', fill = 'none', width = 1.5, opacity = 0.9 } = {}) {
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}" stroke="${esc(color)}" stroke-width="${width}" stroke-opacity="${opacity}" fill="${esc(fill)}" fill-opacity="${opacity}" vector-effect="non-scaling-stroke" />`;
}

export function cross(x, y, { radius = 6, color = '#f59b23', opacity = 0.8 } = {}) {
  return `${line(x - radius, y, x + radius, y, { color, opacity })}${line(x, y - radius, x, y + radius, { color, opacity })}`;
}
