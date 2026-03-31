import type { CameraStatus, GestureDirection } from '../shared/types';

const STYLE_ID = 'gesture-ops-overlay-style';

const ARROW_MAP: Record<Exclude<GestureDirection, 'NONE'>, string> = {
  LEFT: '←',
  RIGHT: '→',
  UP: '↑',
  DOWN: '↓'
};

export class GestureOverlay {
  private readonly root: HTMLDivElement;
  private readonly cameraBadge: HTMLDivElement;
  private readonly cameraDot: HTMLSpanElement;
  private readonly flash: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private readonly navGauge: HTMLDivElement;
  private readonly navGaugeLabel: HTMLSpanElement;
  private navDoneTimer: number | null = null;

  constructor() {
    this.ensureStyle();

    this.root = document.createElement('div');
    this.root.className = 'gesture-ops-root';

    this.cameraBadge = document.createElement('div');
    this.cameraBadge.className = 'gesture-ops-camera';
    this.cameraBadge.innerHTML = '<span class="label">CAM</span>';

    this.cameraDot = document.createElement('span');
    this.cameraDot.className = 'dot off';
    this.cameraBadge.appendChild(this.cameraDot);

    this.flash = document.createElement('div');
    this.flash.className = 'gesture-ops-flash';

    this.cursor = document.createElement('div');
    this.cursor.className = 'gesture-ops-cursor';

    this.navGauge = document.createElement('div');
    this.navGauge.className = 'gesture-ops-nav-gauge';
    this.navGaugeLabel = document.createElement('span');
    this.navGaugeLabel.className = 'gesture-ops-nav-gauge-label';
    this.navGauge.appendChild(this.navGaugeLabel);

    this.root.appendChild(this.cameraBadge);
    this.root.appendChild(this.flash);
    this.root.appendChild(this.navGauge);
    this.root.appendChild(this.cursor);
    document.documentElement.appendChild(this.root);
  }

  setCameraStatus(status: CameraStatus): void {
    this.cameraDot.classList.remove('off', 'on', 'error');

    if (status === 'IN_USE') {
      this.cameraDot.classList.add('on');
      return;
    }

    if (status === 'ERROR') {
      this.cameraDot.classList.add('error');
      return;
    }

    this.cameraDot.classList.add('off');
  }

  showGesture(direction: Exclude<GestureDirection, 'NONE'>): void {
    this.flash.textContent = ARROW_MAP[direction];
    this.flash.classList.remove('active');
    void this.flash.offsetWidth;
    this.flash.classList.add('active');
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setCursorEnabled(enabled: boolean): void {
    this.cursor.classList.toggle('enabled', enabled);
    if (!enabled) {
      this.cursor.classList.remove('visible');
      this.hideNavCharge();
    }
  }

  setCursorVisible(visible: boolean): void {
    this.cursor.classList.toggle('visible', visible);
  }

  updateCursor(normX: number, normY: number): { x: number; y: number } {
    const x = clamp(normX, 0, 1) * window.innerWidth;
    const y = clamp(normY, 0, 1) * window.innerHeight;
    this.cursor.style.left = `${x}px`;
    this.cursor.style.top = `${y}px`;
    this.navGauge.style.left = `${x}px`;
    this.navGauge.style.top = `${y}px`;
    return { x, y };
  }

  flashCursorClick(): void {
    this.cursor.classList.remove('click');
    void this.cursor.offsetWidth;
    this.cursor.classList.add('click');
  }

  showNavCharge(direction: 'BACK' | 'FORWARD', progress: number): void {
    this.navGauge.classList.add('visible');
    this.navGauge.style.setProperty('--progress', `${Math.round(clamp(progress, 0, 1) * 360)}deg`);
    this.navGaugeLabel.textContent = direction === 'BACK' ? '←' : '→';
  }

  hideNavCharge(): void {
    if (this.navDoneTimer !== null) {
      window.clearTimeout(this.navDoneTimer);
      this.navDoneTimer = null;
    }
    this.navGauge.classList.remove('visible');
    this.navGauge.classList.remove('done');
    this.navGauge.style.setProperty('--progress', '0deg');
  }

  flashNavChargeDone(): void {
    if (this.navDoneTimer !== null) {
      window.clearTimeout(this.navDoneTimer);
      this.navDoneTimer = null;
    }

    this.navGauge.classList.add('visible');
    this.navGauge.classList.remove('done');
    void this.navGauge.offsetWidth;
    this.navGauge.classList.add('done');
    this.navDoneTimer = window.setTimeout(() => {
      this.navGauge.classList.remove('done');
      this.navGauge.classList.remove('visible');
      this.navGauge.style.setProperty('--progress', '0deg');
      this.navDoneTimer = null;
    }, 240);
  }

  remove(): void {
    this.root.remove();
  }

  private ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .gesture-ops-root {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
      }

      .gesture-ops-camera {
        position: fixed;
        top: 14px;
        right: 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 9px;
        border-radius: 999px;
        background: rgba(22, 24, 34, 0.46);
        color: rgba(255, 255, 255, 0.9);
        font: 600 11px/1.1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        letter-spacing: 0.02em;
        backdrop-filter: blur(4px);
      }

      .gesture-ops-camera .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #6b7280;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
      }

      .gesture-ops-camera .dot.on {
        background: #2bd471;
      }

      .gesture-ops-camera .dot.error {
        background: #f87171;
      }

      .gesture-ops-flash {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%) scale(0.88);
        min-width: 68px;
        min-height: 68px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 18px;
        background: rgba(11, 16, 26, 0.68);
        color: rgba(255, 255, 255, 0.96);
        font: 700 42px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        opacity: 0;
      }

      .gesture-ops-flash.active {
        animation: gesture-ops-pop 420ms ease-out;
      }

      .gesture-ops-cursor {
        position: fixed;
        left: -9999px;
        top: -9999px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid rgba(67, 221, 255, 0.95);
        background: rgba(67, 221, 255, 0.18);
        transform: translate(-50%, -50%);
        opacity: 0;
        transition: opacity 120ms ease-out;
      }

      .gesture-ops-cursor.enabled.visible {
        opacity: 1;
      }

      .gesture-ops-cursor.click {
        animation: gesture-ops-click 220ms ease-out;
      }

      .gesture-ops-nav-gauge {
        --progress: 0deg;
        position: fixed;
        left: -9999px;
        top: -9999px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        align-items: center;
        justify-content: center;
        background: conic-gradient(
          rgba(67, 221, 255, 0.94) var(--progress),
          rgba(255, 255, 255, 0.2) 0deg
        );
        opacity: 0;
        transition: opacity 120ms ease-out;
      }

      .gesture-ops-nav-gauge::after {
        content: '';
        position: absolute;
        inset: 4px;
        border-radius: 50%;
        background: rgba(11, 16, 26, 0.75);
      }

      .gesture-ops-nav-gauge.visible {
        opacity: 1;
      }

      .gesture-ops-nav-gauge.done {
        animation: gesture-ops-nav-done 220ms ease-out;
      }

      .gesture-ops-nav-gauge-label {
        position: relative;
        z-index: 1;
        color: rgba(255, 255, 255, 0.98);
        font: 700 16px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      @keyframes gesture-ops-pop {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.78);
        }
        22% {
          opacity: 0.95;
          transform: translate(-50%, -50%) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(1.04);
        }
      }

      @keyframes gesture-ops-click {
        0% {
          transform: translate(-50%, -50%) scale(1);
        }
        60% {
          transform: translate(-50%, -50%) scale(0.82);
        }
        100% {
          transform: translate(-50%, -50%) scale(1);
        }
      }

      @keyframes gesture-ops-nav-done {
        0% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
        100% {
          transform: translate(-50%, -50%) scale(1.15);
          opacity: 0;
        }
      }
    `;

    document.documentElement.appendChild(style);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
