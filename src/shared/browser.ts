/**
 * Cross-browser extension API.
 *
 * Wraps `webextension-polyfill` to provide a unified, promise-based
 * `browser.*` API that works identically in Chrome, Firefox, and Safari.
 * All source files should import `browser` from this module instead
 * of using the global `chrome` namespace directly.
 */
import browser from 'webextension-polyfill';
export type { Runtime, Storage, Tabs, Commands } from 'webextension-polyfill';

export default browser;
