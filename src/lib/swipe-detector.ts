import { DEFAULT_SETTINGS } from '../shared/constants';
import type { GestureDirection, GestureSettings } from '../shared/types';

interface Point {
  x: number;
  y: number;
  t: number;
}

export class SwipeDetector {
  private points: Point[] = [];
  private cooldownUntil = 0;
  private lockedAxis: 'x' | 'y' | null = null;
  private config: GestureSettings;

  constructor(config: GestureSettings = DEFAULT_SETTINGS) {
    this.config = config;
  }

  setConfig(config: GestureSettings): void {
    this.config = config;
    this.reset();
  }

  reset(): void {
    this.points = [];
    this.cooldownUntil = 0;
    this.lockedAxis = null;
  }

  update(x: number, y: number, nowMs: number): GestureDirection {
    const last = this.points.at(-1);
    if (last) {
      const stepDistance = Math.hypot(x - last.x, y - last.y);
      if (stepDistance < this.config.minStepDistance) {
        this.trim(nowMs);
        return 'NONE';
      }
    }

    this.points.push({ x, y, t: nowMs });
    this.trim(nowMs);

    if (nowMs < this.cooldownUntil || this.points.length < 2) {
      return 'NONE';
    }

    const first = this.points[0];
    const current = this.points[this.points.length - 1];
    const dx = current.x - first.x;
    const dy = current.y - first.y;

    const axis = this.resolveAxis(dx, dy, current);
    if (!axis) {
      return 'NONE';
    }

    const netDistance = Math.abs(axis === 'x' ? dx : dy);
    if (netDistance < this.config.minSwipeDistance) {
      return 'NONE';
    }

    const consistency = this.calculateConsistency(axis);
    if (consistency < this.config.minConsistency) {
      return 'NONE';
    }

    const gesture: GestureDirection = axis === 'x'
      ? dx > 0
        ? 'RIGHT'
        : 'LEFT'
      : dy > 0
        ? 'DOWN'
        : 'UP';

    if (!this.isAngleAllowed(dx, dy, gesture)) {
      this.points = [current];
      this.lockedAxis = null;
      return 'NONE';
    }

    const cooldownMs = axis === 'x'
      ? this.config.horizontalCooldownMs
      : this.config.verticalCooldownMs;
    this.cooldownUntil = nowMs + cooldownMs;
    this.points = [current];
    this.lockedAxis = null;
    return gesture;
  }

  private resolveAxis(dx: number, dy: number, current: Point): 'x' | 'y' | null {
    if (!this.lockedAxis) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const maxDistance = Math.max(absX, absY);
      if (maxDistance < this.config.axisLockDistance) {
        return null;
      }

      if (absX >= absY * this.config.axisLockRatio) {
        this.lockedAxis = 'x';
      } else if (absY >= absX * this.config.axisLockRatio) {
        this.lockedAxis = 'y';
      } else {
        this.points = [current];
        return null;
      }
    }

    const primary = Math.abs(this.lockedAxis === 'x' ? dx : dy);
    const secondary = Math.abs(this.lockedAxis === 'x' ? dy : dx);
    if (primary > 0 && secondary > primary * this.config.maxOffAxisRatio) {
      this.points = [current];
      this.lockedAxis = null;
      return null;
    }

    return this.lockedAxis;
  }

  private isAngleAllowed(
    dx: number,
    dy: number,
    gesture: Exclude<GestureDirection, 'NONE'>
  ): boolean {
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const targetAngle =
      gesture === 'RIGHT'
        ? 0
        : gesture === 'LEFT'
          ? 180
          : gesture === 'DOWN'
            ? 90
            : -90;
    const delta = Math.abs((((angle - targetAngle) % 360) + 540) % 360 - 180);
    return delta <= this.config.angleToleranceDeg;
  }

  private calculateConsistency(axis: 'x' | 'y'): number {
    if (this.points.length < 2) {
      return 0;
    }

    let total = 0;
    for (let i = 1; i < this.points.length; i += 1) {
      const prev = this.points[i - 1];
      const curr = this.points[i];
      total += Math.abs(axis === 'x' ? curr.x - prev.x : curr.y - prev.y);
    }

    if (total === 0) {
      return 0;
    }

    const first = this.points[0];
    const last = this.points[this.points.length - 1];
    const net = Math.abs(axis === 'x' ? last.x - first.x : last.y - first.y);
    return net / total;
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - this.config.windowMs;
    this.points = this.points.filter((p) => p.t >= cutoff);
    if (this.points.length < 2) {
      this.lockedAxis = null;
    }
  }
}
