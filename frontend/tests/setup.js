import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

if (typeof window !== 'undefined' && (!window.localStorage || typeof window.localStorage.clear !== 'function')) {
  const mem = createMemoryStorage();
  Object.defineProperty(window, 'localStorage', {
    writable: true,
    configurable: true,
    value: mem,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    writable: true,
    configurable: true,
    value: mem,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage?.clear?.();
  document.documentElement.setAttribute('data-theme', 'light');
  vi.restoreAllMocks();
});

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
