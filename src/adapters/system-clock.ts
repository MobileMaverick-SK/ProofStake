import type { Clock } from '../core/shared';

export const systemClock: Clock = { now: () => new Date() };
