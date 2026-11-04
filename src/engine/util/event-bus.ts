import type { ServerEvent } from '../../shared/events.js';

export type EventListener = (event: ServerEvent) => void;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type PublishableEvent = DistributiveOmit<ServerEvent, 'seq' | 'at'> & { at?: string };

/**
 * ناقل أحداث المحرّك. كل حدث يحمل seq تصاعديًا ليمكن للواجهة كشف الفجوات.
 */
export class EventBus {
  private seq = 0;
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: PublishableEvent): ServerEvent {
    this.seq += 1;
    const full = {
      ...event,
      seq: this.seq,
      at: event.at ?? new Date().toISOString(),
    } as ServerEvent;
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // مستمع فاشل لا يوقف الآخرين.
      }
    }
    return full;
  }

  get currentSeq(): number {
    return this.seq;
  }
}
