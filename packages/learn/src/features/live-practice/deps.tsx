import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useApi, useLearnClient } from '../../context';
import { browserModelStore, liveApi, type SpeakerModelStore } from '../../lib/live-practice';
import { BrowserLiveMic, canListen, type LiveMic } from '../../lib/live/mic';
import { connectBrowserRealtime, type RealtimeConnector } from '../../lib/live/realtime';
import { ortSpeakerEmbedder, type SpeakerEmbedderFactory } from '../../lib/live/speaker-embedder';
import { VoiceRepository } from '../../lib/live/voice';

/**
 * The hardware and services behind live practice: the microphone, the
 * socket to OpenAI, the speaker model and its embedder, and whether this
 * page may listen at all. The browser's by default; tests swap in fakes.
 */
export interface LiveDeps {
  createMic: () => LiveMic;
  connect: RealtimeConnector;
  createEmbedder: SpeakerEmbedderFactory;
  /** Defaults to the Cache API over the client's `download`. */
  models?: SpeakerModelStore;
  /** Whether the microphone can be used here (a secure context). */
  canListen: () => boolean;
}

const DEFAULTS: LiveDeps = {
  createMic: () => new BrowserLiveMic(),
  connect: connectBrowserRealtime,
  createEmbedder: ortSpeakerEmbedder,
  canListen,
};

const LiveDepsContext = createContext<Partial<LiveDeps> | null>(null);

/** Overrides some of the live-practice dependencies (tests). */
export function LiveDepsProvider({
  deps,
  children,
}: {
  deps: Partial<LiveDeps>;
  children: ReactNode;
}) {
  return <LiveDepsContext.Provider value={deps}>{children}</LiveDepsContext.Provider>;
}

export interface ResolvedLiveDeps extends Required<LiveDeps> {
  voice: VoiceRepository;
}

export function useLiveDeps(): ResolvedLiveDeps {
  const overrides = useContext(LiveDepsContext);
  const client = useLearnClient();
  const api = useApi();
  return useMemo(() => {
    const deps = { ...DEFAULTS, ...overrides };
    const models = deps.models ?? browserModelStore(client);
    const voice = new VoiceRepository(liveApi(api), models, deps.createEmbedder, deps.createMic);
    return { ...deps, models, voice };
  }, [overrides, client, api]);
}
