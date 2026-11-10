import { AsyncLocalStorage } from 'node:async_hooks';
import type { DomainEvent, EventBus, EventOf, EventType, Handler } from '../../core/shared';

type AnyHandler = (event: DomainEvent) => Promise<void>;
export type HandlerErrorListener = (error: unknown, event: DomainEvent) => void;

/**
 * Events are handled strictly first-in, first-out. An event published from inside
 * a handler is queued behind the events already waiting, so every module sees
 * events in the order they happened, whatever order the modules subscribed in.
 *
 * A failing handler does not stop the other handlers; the failure is reported
 * to `onError`.
 */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<EventType, AnyHandler[]>();
  private readonly queue: DomainEvent[] = [];
  private readonly insideHandler = new AsyncLocalStorage<true>();
  private draining: Promise<void> | null = null;

  constructor(
    private readonly onError: HandlerErrorListener = (error, event) =>
      console.error(`[event-bus] handler for ${event.type} failed`, error),
  ) {}

  subscribe<T extends EventType>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push((event) => handler(event as EventOf<T>));
    this.handlers.set(type, list);
  }

  async publish(event: DomainEvent): Promise<void> {
    this.queue.push(event);
    // A handler must not wait for its own follow-up events: the running drain will reach them.
    if (this.insideHandler.getStore()) return;
    while (this.queue.length > 0 || this.draining) {
      this.draining ??= this.drain().finally(() => {
        this.draining = null;
      });
      await this.draining;
    }
  }

  private async drain(): Promise<void> {
    for (let event = this.queue.shift(); event; event = this.queue.shift()) {
      for (const handler of this.handlers.get(event.type) ?? []) {
        const current = event;
        try {
          await this.insideHandler.run(true, () => handler(current));
        } catch (error) {
          this.onError(error, current);
        }
      }
    }
  }
}
