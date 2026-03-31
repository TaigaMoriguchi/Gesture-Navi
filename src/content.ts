import { HandLandmarker } from '@mediapipe/tasks-vision';
import { GestureOverlay } from './lib/overlay';
import { SwipeDetector } from './lib/swipe-detector';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TAB_STATE,
  SCROLL_DELTA_PX,
  STORAGE_KEYS,
  sanitizeSettings
} from './shared/constants';
import type { RuntimeMessage } from './shared/messages';
import type {
  CameraStatus,
  GestureDirection,
  GestureSettings,
  HandStatus,
  RuntimeTabState
} from './shared/types';

interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

const NAV_CHARGE_START_PX = 92;
const NAV_CHARGE_AXIS_RATIO = 1.55;
const NAV_CHARGE_MAX_VERTICAL_DRIFT_PX = 56;
const NAV_CHARGE_MIN_PULL_PX = 64;
const NAV_CHARGE_HOLD_MS = 620;
const NAV_CHARGE_COOLDOWN_MS = 1150;
const SUPPRESSED_WASM_WARNING_PATTERNS = [
  'gl_context.cc:1118] OpenGL error checking is disabled',
  'landmark_projection_calculator.cc:81] Using NORM_RECT without IMAGE_DIMENSIONS is only supported for the square ROI. Provide IMAGE_DIMENSIONS or use PROJECTION_MATRIX.'
] as const;

class GestureRuntime {
  private readonly overlay = new GestureOverlay();
  private readonly swipeDetector = new SwipeDetector(DEFAULT_SETTINGS);

  private settings: GestureSettings = { ...DEFAULT_SETTINGS };

  private handLandmarker: HandLandmarker | null = null;
  private wasmFilesetPromise: Promise<Parameters<typeof HandLandmarker.createFromOptions>[0]> | null =
    null;
  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;

  private running = false;
  private starting = false;
  private hasCameraPermission = false;
  private frameRequestId: number | null = null;

  private smoothedCursorPoint: { x: number; y: number } | null = null;
  private cursorScreenPoint: { x: number; y: number } | null = null;

  private pinching = false;
  private pinchCooldownUntil = 0;
  private pinchStartedAtMs = 0;
  private pinchDragDistancePx = 0;
  private pinchLastPoint: { x: number; y: number } | null = null;
  private pinchStartPoint: { x: number; y: number } | null = null;
  private pinchHasNavIntent = false;

  private navChargeDirection: 'BACK' | 'FORWARD' | null = null;
  private navChargeStartedAtMs = 0;
  private navCooldownUntil = 0;

  private state: RuntimeTabState = { ...DEFAULT_TAB_STATE };

  async init(): Promise<void> {
    this.patchState({ ...DEFAULT_TAB_STATE });
    this.overlay.setVisible(false);

    chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.type === 'EXTENSION_TOGGLE') {
        void this.applyEnabled(message.enabled);
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }

      if (changes[STORAGE_KEYS.settings]) {
        this.applySettings(changes[STORAGE_KEYS.settings].newValue);
      }
    });

    window.addEventListener('beforeunload', () => {
      void this.stop();
      this.overlay.remove();
    });

    const storage = await chrome.storage.local.get([
      STORAGE_KEYS.extensionEnabled,
      STORAGE_KEYS.settings
    ]);

    this.applySettings(storage[STORAGE_KEYS.settings]);
    const enabled = Boolean(storage[STORAGE_KEYS.extensionEnabled]);
    await this.applyEnabled(enabled);
  }

  private applySettings(rawSettings: unknown): void {
    const previousMode = this.settings.interactionMode;
    this.settings = sanitizeSettings(rawSettings);
    this.swipeDetector.setConfig(this.settings);

    const cursorMode = this.isCursorPinchMode();
    this.overlay.setCursorEnabled(cursorMode);

    if (!cursorMode || previousMode !== this.settings.interactionMode) {
      this.resetCursorTransientState();
    }
  }

  private isCursorPinchMode(): boolean {
    return this.settings.interactionMode === 'CURSOR_PINCH';
  }

  private isSwipeMode(): boolean {
    return this.settings.interactionMode === 'SWIPE';
  }

  private async applyEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.start();
      return;
    }

    await this.stop();
  }

  private async start(): Promise<void> {
    if (this.running || this.starting) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.overlay.setVisible(true);
      this.overlay.setCameraStatus('ERROR');
      this.patchState({
        cameraStatus: 'ERROR',
        handStatus: 'NOT_DETECTED',
        errorMessage: 'このページではカメラAPIを利用できません。'
      });
      return;
    }

    this.starting = true;
    this.overlay.setVisible(true);

    try {
      await this.ensureLandmarker();
      await this.startCamera();

      this.running = true;
      this.overlay.setCameraStatus('IN_USE');
      this.patchState({
        cameraStatus: 'IN_USE',
        handStatus: 'NOT_DETECTED',
        errorMessage: undefined
      });

      this.loop();
    } catch (error) {
      this.overlay.setVisible(true);
      const permissionDenied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const detail =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '不明なエラー';

      this.overlay.setCameraStatus(permissionDenied ? 'NOT_GRANTED' : 'ERROR');
      this.patchState({
        cameraStatus: permissionDenied ? 'NOT_GRANTED' : 'ERROR',
        handStatus: 'NOT_DETECTED',
        errorMessage: permissionDenied
          ? 'カメラが未許可です。popupを開いた状態で再度ONにしてください。'
          : `認識初期化に失敗しました: ${detail}`
      });

      await this.stopCameraOnly();
    } finally {
      this.starting = false;
    }
  }

  private async ensureLandmarker(): Promise<void> {
    if (this.handLandmarker) {
      return;
    }

    const baseOptions = {
      modelAssetPath: chrome.runtime.getURL('assets/models/hand_landmarker.task')
    };

    try {
      const wasmFileset = await this.resolveWasmFileset(true);
      this.handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          ...baseOptions,
          delegate: 'GPU'
        },
        numHands: 1,
        runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5
      });
    } catch {
      const wasmFileset = await this.resolveWasmFileset(true);
      this.handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          ...baseOptions,
          delegate: 'CPU'
        },
        numHands: 1,
        runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5
      });
    }
  }

  private async resolveWasmFileset(
    forceReload = false
  ): Promise<Parameters<typeof HandLandmarker.createFromOptions>[0]> {
    if (forceReload) {
      this.wasmFilesetPromise = null;
    }

    if (!this.wasmFilesetPromise) {
      this.wasmFilesetPromise = (async () => {
        const moduleUrl = chrome.runtime.getURL('assets/wasm/vision_wasm_module_internal.js');
        const binaryUrl = chrome.runtime.getURL('assets/wasm/vision_wasm_module_internal.wasm');
        const globals = self as {
          ModuleFactory?: unknown;
          custom_dbg?: (...args: unknown[]) => void;
        };
        if (typeof globals.custom_dbg !== 'function') {
          globals.custom_dbg = (...args: unknown[]) => {
            if (shouldSuppressWasmWarning(args)) {
              return;
            }
            console.warn('[GestureOps/WASM]', ...args);
          };
        }

        const moduleObject = (await import(moduleUrl)) as { default?: unknown };

        if (typeof moduleObject.default !== 'function') {
          throw new Error('WASMローダーの読み込みに失敗しました。');
        }

        globals.ModuleFactory = moduleObject.default;
        return {
          wasmLoaderPath: '',
          wasmBinaryPath: binaryUrl
        };
      })();
    }

    return this.wasmFilesetPromise;
  }

  private async startCamera(): Promise<void> {
    this.videoEl = document.createElement('video');
    this.videoEl.autoplay = true;
    this.videoEl.playsInline = true;
    this.videoEl.muted = true;
    this.videoEl.style.position = 'fixed';
    this.videoEl.style.width = '1px';
    this.videoEl.style.height = '1px';
    this.videoEl.style.opacity = '0';
    this.videoEl.style.pointerEvents = 'none';

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
    this.hasCameraPermission = true;
  }

  private loop(): void {
    const tick = (): void => {
      if (!this.running || !this.videoEl || !this.handLandmarker) {
        return;
      }

      const now = performance.now();
      const result = this.handLandmarker.detectForVideo(this.videoEl, now);
      const landmarks = result.landmarks[0] as LandmarkPoint[] | undefined;

      if (!landmarks) {
        this.setHandStatus('NOT_DETECTED');
        this.resetHandTransientState();
      } else {
        this.setHandStatus('DETECTED');

        if (this.isCursorPinchMode()) {
          this.updateVirtualCursor(landmarks);
          this.handlePinchGesture(landmarks, now);
        } else {
          this.resetCursorTransientState();
          const point = landmarks[8] ?? landmarks[0];
          if (point) {
            const gesture = this.swipeDetector.update(point.x, point.y, now);
            if (gesture !== 'NONE') {
              this.onGesture(gesture);
            }
          }
        }
      }

      this.frameRequestId = requestAnimationFrame(tick);
    };

    this.frameRequestId = requestAnimationFrame(tick);
  }

  private updateVirtualCursor(landmarks: LandmarkPoint[]): void {
    if (!this.isCursorPinchMode()) {
      return;
    }

    const center = this.getPalmCenter(landmarks);
    if (!center) {
      this.overlay.setCursorVisible(false);
      this.smoothedCursorPoint = null;
      this.cursorScreenPoint = null;
      return;
    }

    if (!this.smoothedCursorPoint) {
      this.smoothedCursorPoint = center;
    } else {
      const alpha = this.settings.cursorSmoothing;
      this.smoothedCursorPoint = {
        x: this.smoothedCursorPoint.x + (center.x - this.smoothedCursorPoint.x) * alpha,
        y: this.smoothedCursorPoint.y + (center.y - this.smoothedCursorPoint.y) * alpha
      };
    }

    const normalizedX = this.settings.cursorMirrorX
      ? 1 - this.smoothedCursorPoint.x
      : this.smoothedCursorPoint.x;

    this.cursorScreenPoint = this.overlay.updateCursor(normalizedX, this.smoothedCursorPoint.y);
    this.overlay.setCursorVisible(true);
  }

  private handlePinchGesture(landmarks: LandmarkPoint[], nowMs: number): void {
    if (!this.isCursorPinchMode() || !this.cursorScreenPoint) {
      this.resetPinchState();
      return;
    }

    const pinchRatio = this.computePinchRatio(landmarks);
    if (!Number.isFinite(pinchRatio)) {
      this.resetPinchState();
      return;
    }

    if (!this.pinching) {
      if (nowMs < this.pinchCooldownUntil || nowMs < this.navCooldownUntil) {
        return;
      }

      if (pinchRatio <= this.settings.pinchStartRatio) {
        this.pinching = true;
        this.pinchStartedAtMs = nowMs;
        this.pinchDragDistancePx = 0;
        this.pinchLastPoint = { ...this.cursorScreenPoint };
        this.pinchStartPoint = { ...this.cursorScreenPoint };
        this.pinchHasNavIntent = false;
        this.clearNavCharge();
      }
      return;
    }

    if (pinchRatio >= this.settings.pinchEndRatio) {
      this.finishPinch(nowMs);
      return;
    }

    if (!this.pinchLastPoint || !this.cursorScreenPoint) {
      this.pinchLastPoint = this.cursorScreenPoint ? { ...this.cursorScreenPoint } : null;
      return;
    }

    const dx = this.cursorScreenPoint.x - this.pinchLastPoint.x;
    const dy = this.cursorScreenPoint.y - this.pinchLastPoint.y;
    this.pinchLastPoint = { ...this.cursorScreenPoint };

    if (!this.pinchStartPoint) {
      this.pinchStartPoint = { ...this.cursorScreenPoint };
    }

    const totalDx = this.cursorScreenPoint.x - this.pinchStartPoint.x;
    const totalDy = this.cursorScreenPoint.y - this.pinchStartPoint.y;

    const navCharging = this.updateNavCharge(nowMs, totalDx, totalDy);
    if (navCharging) {
      return;
    }

    if (dx === 0 && dy === 0) {
      return;
    }

    this.pinchDragDistancePx += Math.hypot(dx, dy);
    const factor = this.settings.pinchDragScrollFactor;
    window.scrollBy({
      left: -dx * factor,
      top: -dy * factor,
      behavior: 'auto'
    });
  }

  private finishPinch(nowMs: number): void {
    const duration = nowMs - this.pinchStartedAtMs;
    const canTapClick =
      this.pinchDragDistancePx <= this.settings.pinchTapMaxMovePx &&
      duration <= this.settings.pinchTapMaxDurationMs &&
      !this.pinchHasNavIntent;

    if (canTapClick && this.cursorScreenPoint) {
      this.dispatchVirtualClick(this.cursorScreenPoint);
    }

    this.resetPinchState();
    this.pinchCooldownUntil = nowMs + this.settings.pinchCooldownMs;
  }

  private resetPinchState(): void {
    this.pinching = false;
    this.pinchStartedAtMs = 0;
    this.pinchDragDistancePx = 0;
    this.pinchLastPoint = null;
    this.pinchStartPoint = null;
    this.pinchHasNavIntent = false;
    this.clearNavCharge();
  }

  private updateNavCharge(nowMs: number, totalDx: number, totalDy: number): boolean {
    if (nowMs < this.navCooldownUntil) {
      this.clearNavCharge();
      return false;
    }

    const absDx = Math.abs(totalDx);
    const absDy = Math.abs(totalDy);

    if (!this.navChargeDirection) {
      const canStart =
        absDx >= NAV_CHARGE_START_PX &&
        absDx >= absDy * NAV_CHARGE_AXIS_RATIO &&
        absDy <= NAV_CHARGE_MAX_VERTICAL_DRIFT_PX;

      if (!canStart) {
        return false;
      }

      this.navChargeDirection = totalDx > 0 ? 'BACK' : 'FORWARD';
      this.navChargeStartedAtMs = nowMs;
      this.pinchHasNavIntent = true;
    }

    if (!this.navChargeDirection) {
      return false;
    }

    const directionSign = this.navChargeDirection === 'BACK' ? 1 : -1;
    const directionalPull = totalDx * directionSign;
    const stillAligned =
      directionalPull >= NAV_CHARGE_MIN_PULL_PX &&
      Math.abs(totalDx) >= Math.abs(totalDy) * NAV_CHARGE_AXIS_RATIO &&
      Math.abs(totalDy) <= NAV_CHARGE_MAX_VERTICAL_DRIFT_PX;

    if (!stillAligned) {
      this.clearNavCharge();
      return false;
    }

    const progress = clamp((nowMs - this.navChargeStartedAtMs) / NAV_CHARGE_HOLD_MS, 0, 1);
    this.overlay.showNavCharge(this.navChargeDirection, progress);

    if (progress >= 1) {
      this.commitNavCharge(this.navChargeDirection, nowMs);
      return true;
    }

    return true;
  }

  private commitNavCharge(direction: 'BACK' | 'FORWARD', nowMs: number): void {
    if (direction === 'BACK') {
      this.patchState({ lastGesture: 'RIGHT' });
      this.overlay.showGesture('RIGHT');
      window.history.back();
    } else {
      this.patchState({ lastGesture: 'LEFT' });
      this.overlay.showGesture('LEFT');
      window.history.forward();
    }

    this.navChargeDirection = null;
    this.navChargeStartedAtMs = 0;
    this.overlay.flashNavChargeDone();
    this.navCooldownUntil = nowMs + NAV_CHARGE_COOLDOWN_MS;
  }

  private clearNavCharge(): void {
    this.navChargeDirection = null;
    this.navChargeStartedAtMs = 0;
    this.overlay.hideNavCharge();
  }

  private dispatchVirtualClick(point: { x: number; y: number }): void {
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) {
      return;
    }

    const base = {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      view: window
    };

    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...base,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1
        })
      );
    }
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));

    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(
        new PointerEvent('pointerup', {
          ...base,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0
        })
      );
    }
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0 }));
    this.overlay.flashCursorClick();
  }

  private computePinchRatio(landmarks: LandmarkPoint[]): number {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const palmLeft = landmarks[5];
    const palmRight = landmarks[17];

    if (!thumbTip || !indexTip || !palmLeft || !palmRight) {
      return Number.POSITIVE_INFINITY;
    }

    const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    const palmWidth = Math.hypot(palmLeft.x - palmRight.x, palmLeft.y - palmRight.y);
    if (palmWidth < 1e-4) {
      return Number.POSITIVE_INFINITY;
    }

    return pinchDistance / palmWidth;
  }

  private getPalmCenter(landmarks: LandmarkPoint[]): { x: number; y: number } | null {
    const indices = [0, 5, 9, 13, 17];
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (const index of indices) {
      const point = landmarks[index];
      if (!point) {
        continue;
      }
      sumX += point.x;
      sumY += point.y;
      count += 1;
    }

    if (count === 0) {
      return null;
    }

    return {
      x: sumX / count,
      y: sumY / count
    };
  }

  private resetCursorTransientState(): void {
    this.overlay.setCursorVisible(false);
    this.smoothedCursorPoint = null;
    this.cursorScreenPoint = null;
    this.resetPinchState();
  }

  private resetHandTransientState(): void {
    this.swipeDetector.reset();
    this.resetCursorTransientState();
  }

  private onGesture(gesture: Exclude<GestureDirection, 'NONE'>): void {
    this.overlay.showGesture(gesture);
    this.patchState({ lastGesture: gesture });

    if (gesture === 'RIGHT') {
      window.history.forward();
      return;
    }

    if (gesture === 'LEFT') {
      window.history.back();
      return;
    }

    if (gesture === 'UP') {
      window.scrollBy({ top: SCROLL_DELTA_PX, behavior: 'smooth' });
      return;
    }

    window.scrollBy({ top: -SCROLL_DELTA_PX, behavior: 'smooth' });
  }

  private setHandStatus(status: HandStatus): void {
    this.patchState({ handStatus: status });
  }

  private async stop(): Promise<void> {
    this.running = false;

    if (this.frameRequestId !== null) {
      cancelAnimationFrame(this.frameRequestId);
      this.frameRequestId = null;
    }

    this.resetHandTransientState();
    await this.stopCameraOnly();

    const cameraStatus: CameraStatus = this.hasCameraPermission ? 'GRANTED' : 'NOT_GRANTED';
    this.overlay.setCameraStatus(cameraStatus);
    this.overlay.setVisible(false);

    this.patchState({
      cameraStatus,
      handStatus: 'NOT_DETECTED'
    });
  }

  private async stopCameraOnly(): Promise<void> {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }
  }

  private patchState(patch: Partial<RuntimeTabState>): void {
    let changed = false;
    const nextState: RuntimeTabState = { ...this.state };

    for (const [rawKey, value] of Object.entries(patch)) {
      const key = rawKey as keyof RuntimeTabState;
      if (nextState[key] !== value) {
        (nextState as any)[key] = value;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    nextState.updatedAt = Date.now();
    this.state = nextState;

    void chrome.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: this.state
    } satisfies RuntimeMessage);
  }
}

const runtime = new GestureRuntime();
void runtime.init();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shouldSuppressWasmWarning(args: unknown[]): boolean {
  const text = args
    .map((arg) => (typeof arg === 'string' ? arg : String(arg)))
    .join(' ');

  return SUPPRESSED_WASM_WARNING_PATTERNS.some((pattern) => text.includes(pattern));
}
