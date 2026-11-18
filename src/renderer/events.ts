type Fn = (...args: any[]) => void;

/** Tiny EventEmitter with the subset of Node's API the Java renderer's `eventEmitter` is used for (`on`, `off`, `once`, `emit`). */
export class EventEmitter {
  private map = new Map<string, Set<Fn>>();
  on(event: string, fn: Fn): this { (this.map.get(event) ?? this.map.set(event, new Set()).get(event)!).add(fn); return this; }
  off(event: string, fn: Fn): this { this.map.get(event)?.delete(fn); return this; }
  once(event: string, fn: Fn): this { const w: Fn = (...a) => { this.off(event, w); fn(...a); }; return this.on(event, w); }
  emit(event: string, ...args: unknown[]): boolean {
    const set = this.map.get(event);
    if (!set?.size) return false;
    for (const fn of [...set]) fn(...args);
    return true;
  }
  removeAllListeners(event?: string): this { if (event) this.map.delete(event); else this.map.clear(); return this; }
  listenerCount(event: string): number { return this.map.get(event)?.size ?? 0; }
}
