import type { Clock } from '../../core/shared';

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-11-10T09:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}
