/**
 * The session to open after the voice setup, when the setup was offered
 * before a new session (the phone does the same). Kept for this page load only.
 */
let next: string | null = null;

export function setVoiceSetupNext(sessionId: string | null): void {
  next = sessionId;
}

/** The session waiting for the voice setup, if any (it stays until cleared). */
export function voiceSetupNext(): string | null {
  return next;
}
