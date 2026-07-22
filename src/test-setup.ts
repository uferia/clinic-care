// `$localize` (the global that i18n-marked templates compile down to) is
// installed via the `polyfills` entry on the build AND test targets in
// angular.json — importing it here instead triggers Angular's
// "Direct import of '@angular/localize/init'" warning.

// Node 26 ships an experimental global `localStorage` that is unusable without
// the --localstorage-file flag and shadows jsdom's Storage, so any spec touching
// localStorage throws. Install a deterministic in-memory Storage for tests.
class MemoryStorage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});
