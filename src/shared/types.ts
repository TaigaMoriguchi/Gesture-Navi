export type GestureDirection = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'NONE';

export type CameraStatus = 'NOT_GRANTED' | 'GRANTED' | 'IN_USE' | 'ERROR';

export type HandStatus = 'DETECTED' | 'NOT_DETECTED';
export type InteractionMode = 'CURSOR_PINCH' | 'SWIPE';

export interface RuntimeTabState {
  cameraStatus: CameraStatus;
  handStatus: HandStatus;
  lastGesture: GestureDirection;
  updatedAt: number;
  errorMessage?: string;
}

export type TabStateMap = Record<string, RuntimeTabState>;

export interface GestureSettings {
  interactionMode: InteractionMode;
  swipeEnabled: boolean;
  cursorEnabled: boolean;
  pinchClickEnabled: boolean;
  minSwipeDistance: number;
  minStepDistance: number;
  axisLockDistance: number;
  axisLockRatio: number;
  maxOffAxisRatio: number;
  angleToleranceDeg: number;
  windowMs: number;
  horizontalCooldownMs: number;
  verticalCooldownMs: number;
  minConsistency: number;
  cursorSmoothing: number;
  pinchStartRatio: number;
  pinchEndRatio: number;
  pinchCooldownMs: number;
  pinchDragScrollFactor: number;
  pinchTapMaxMovePx: number;
  pinchTapMaxDurationMs: number;
  cursorMirrorX: boolean;
}
