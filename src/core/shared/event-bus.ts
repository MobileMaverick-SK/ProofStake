import type { DomainEvent, EventOf, EventType } from './events';

export type Handler<T extends EventType> = (event: EventOf<T>) => Promise<void>;

export interface EventBus {
  /** Resolves once the event, and every event its handlers published in turn, has been handled. */
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends EventType>(type: T, handler: Handler<T>): void;
}
