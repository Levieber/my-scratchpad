/** A value kept outside React, so anything can set it; components follow it with `useStore`. */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = () => this.value;

  set = (next: T) => {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((fn) => fn());
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
}
