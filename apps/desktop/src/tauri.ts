import type { HuntClient } from '@offerpath/hunt';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

/** Whether the page runs inside the Tauri webview (not a plain browser tab). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * The hunt pages' transport on the desktop: Tauri commands and events by
 * the names registered in src-tauri/src/lib.rs, and the native file picker.
 */
export const tauriClient: HuntClient = {
  invoke: ((command: string, args?: Record<string, unknown>) =>
    invoke(command, args)) as HuntClient['invoke'],
  listen: ((event: string, handler: (payload: unknown) => void) =>
    listen(event, (e) => handler(e.payload))) as HuntClient['listen'],
  pickFiles: async ({ multiple, filters }) => {
    const chosen = await open({ multiple, directory: false, filters });
    if (Array.isArray(chosen)) return chosen;
    return chosen ? [chosen] : [];
  },
};
