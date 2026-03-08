/**
 * Global Vitest setup.
 *
 * Mocks the `webextension-polyfill` module so tests can run outside
 * a browser extension context. Individual test files set up their own
 * chrome mock objects via `vi.stubGlobal('chrome', ...)`.
 *
 * The mock returns `globalThis.chrome` (whatever the test has set up)
 * as the default export, so tests that mock `chrome` still work.
 */
import { vi } from 'vitest';

vi.mock('webextension-polyfill', () => {
  // Return whatever chrome mock the test has set up on globalThis
  return {
    default: new Proxy(
      {},
      {
        get(_target, prop) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (globalThis as any).chrome?.[prop];
        },
      },
    ),
  };
});
