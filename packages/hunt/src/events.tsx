import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { activityFeed, logFeed } from './activity';
import { useHuntClient, type Unlisten } from './client';
import { COLLECTION_KEYS, keys } from './queries';

const SETTLED_STATES = [
  'COMPLETED',
  'FAILED',
  'WAITING_FOR_APPROVAL',
  'MANUAL_ACTION_REQUIRED',
  'WAITING_FOR_USER',
];

/**
 * Mounted once at the root: subscribes to backend events and keeps query
 * caches and the activity/log feeds fresh.
 */
export function HuntEvents() {
  const qc = useQueryClient();
  const client = useHuntClient();
  useEffect(() => {
    const unlisteners: Promise<Unlisten>[] = [];
    unlisteners.push(client.listen('agent:event', (ev) => activityFeed.push(ev)));
    unlisteners.push(
      client.listen('agent:status', (status) => {
        qc.setQueryData(keys.agentStatus, status);
        void qc.invalidateQueries({ queryKey: keys.queue });
        if (SETTLED_STATES.includes(status.state)) {
          void qc.invalidateQueries({ queryKey: keys.dashboard });
          void qc.invalidateQueries({ queryKey: keys.runs });
          void qc.invalidateQueries({ queryKey: keys.jobs });
          void qc.invalidateQueries({ queryKey: keys.applications });
        }
      }),
    );
    unlisteners.push(
      client.listen('sync:status', (status) => {
        qc.setQueryData(keys.sync, status);
        void qc.invalidateQueries({ queryKey: keys.setup });
      }),
    );
    unlisteners.push(client.listen('log:entry', (entry) => logFeed.push(entry)));
    unlisteners.push(
      client.listen('remote:status', (status) => {
        qc.setQueryData(keys.remoteStatus, status);
      }),
    );
    unlisteners.push(
      client.listen('data:changed', (collections) => {
        for (const c of collections) {
          for (const key of COLLECTION_KEYS[c] ?? []) void qc.invalidateQueries({ queryKey: key });
        }
      }),
    );
    return () => {
      for (const p of unlisteners) void p.then((u) => u());
    };
  }, [qc, client]);
  return null;
}
