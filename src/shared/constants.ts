import type { GestureSettings, RuntimeTabState } from './types';

export const STORAGE_KEYS = {
  extensionEnabled: 'extensionEnabled',
  tabStates: 'tabStates',
  settings: 'settings'
} as const;

export const DEFAULT_SETTINGS: GestureSettings = {
  interactionMode: 'CURSOR_PINCH',
  swipeEnabled: false,
  cursorEnabled: true,
  pinchClickEnabled: true,
  minSwipeDistance: 0.14,
  minStepDistance: 0.004,
  axisLockDistance: 0.05,
  axisLockRatio: 1.25,
  maxOffAxisRatio: 0.4,
  angleToleranceDeg: 28,
  windowMs: 750,
  horizontalCooldownMs: 950,
  verticalCooldownMs: 1600,
  minConsistency: 0.6,
  cursorSmoothing: 0.35,
  pinchStartRatio: 0.38,
  pinchEndRatio: 0.58,
  pinchCooldownMs: 360,
  pinchDragScrollFactor: 2.2,
  pinchTapMaxMovePx: 18,
  pinchTapMaxDurationMs: 260,
  cursorMirrorX: true
} as const;

export const SCROLL_DELTA_PX = 420;

export const DEFAULT_TAB_STATE: RuntimeTabState = {
  cameraStatus: 'NOT_GRANTED',
  handStatus: 'NOT_DETECTED',
  lastGesture: 'NONE',
  updatedAt: 0
};

export function sanitizeSettings(input: unknown): GestureSettings {
  const candidate = (input as Partial<GestureSettings> | undefined) ?? {};
  const normalized: GestureSettings = {
    ...DEFAULT_SETTINGS,
    ...candidate
  };

  if (candidate.interactionMode === 'SWIPE' || candidate.interactionMode === 'CURSOR_PINCH') {
    normalized.interactionMode = candidate.interactionMode;
  } else {
    normalized.interactionMode = candidate.swipeEnabled ? 'SWIPE' : 'CURSOR_PINCH';
  }

  normalized.cursorMirrorX = Boolean(
    candidate.cursorMirrorX ?? DEFAULT_SETTINGS.cursorMirrorX
  );

  normalized.windowMs = clamp(normalized.windowMs, 300, 1500);
  normalized.minStepDistance = clamp(normalized.minStepDistance, 0.001, 0.05);
  normalized.axisLockDistance = clamp(normalized.axisLockDistance, 0.02, 0.2);
  normalized.axisLockRatio = clamp(normalized.axisLockRatio, 1, 2.5);
  normalized.minConsistency = clamp(normalized.minConsistency, 0.35, 0.95);
  normalized.angleToleranceDeg = clamp(normalized.angleToleranceDeg, 10, 45);
  normalized.minSwipeDistance = clamp(normalized.minSwipeDistance, 0.08, 0.3);
  normalized.maxOffAxisRatio = clamp(normalized.maxOffAxisRatio, 0.15, 0.8);
  normalized.horizontalCooldownMs = clamp(normalized.horizontalCooldownMs, 300, 2500);
  normalized.verticalCooldownMs = clamp(normalized.verticalCooldownMs, 500, 3000);
  normalized.cursorSmoothing = clamp(normalized.cursorSmoothing, 0.05, 0.95);
  normalized.pinchStartRatio = clamp(normalized.pinchStartRatio, 0.2, 0.7);
  normalized.pinchEndRatio = clamp(normalized.pinchEndRatio, 0.25, 0.9);
  normalized.pinchCooldownMs = clamp(normalized.pinchCooldownMs, 100, 2000);
  normalized.pinchDragScrollFactor = clamp(normalized.pinchDragScrollFactor, 0.8, 4.5);
  normalized.pinchTapMaxMovePx = clamp(normalized.pinchTapMaxMovePx, 4, 80);
  normalized.pinchTapMaxDurationMs = clamp(normalized.pinchTapMaxDurationMs, 80, 600);

  if (normalized.pinchEndRatio <= normalized.pinchStartRatio) {
    normalized.pinchEndRatio = Math.min(0.95, normalized.pinchStartRatio + 0.08);
  }

  if (normalized.interactionMode === 'SWIPE') {
    normalized.swipeEnabled = true;
    normalized.cursorEnabled = false;
    normalized.pinchClickEnabled = false;
  } else {
    normalized.swipeEnabled = false;
    normalized.cursorEnabled = true;
    normalized.pinchClickEnabled = true;
  }

  return normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
