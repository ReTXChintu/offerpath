import { Icon, type IconName } from '@offerpath/ui';
import { useEffect, useRef } from 'react';

import type { AgentEvent } from '../types';

function icon(ev: AgentEvent): { name: IconName; color: string } {
  if (ev.level === 'ERROR') return { name: 'xCircle', color: 'var(--error)' };
  if (ev.level === 'WARN') return { name: 'alert', color: 'var(--warning)' };
  if (ev.level === 'SUCCESS' || ev.kind === 'STEP_DONE')
    return { name: 'check', color: 'var(--success)' };
  return { name: 'dot', color: 'var(--text-muted)' };
}

/** The agent's live narration, newest at the bottom. */
export function ActivityFeed({
  events,
  maxHeight = '420px',
  compact = false,
  autoScroll = true,
}: {
  events: AgentEvent[];
  maxHeight?: string;
  compact?: boolean;
  autoScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length, autoScroll]);
  if (!events.length) {
    return <p className="t-small text-muted py3">No activity yet.</p>;
  }
  return (
    <div
      ref={ref}
      className="scroll-y"
      style={{ maxHeight, paddingRight: 8 }}
      role="log"
      aria-label="Agent activity"
    >
      <div className="col" style={{ gap: compact ? 4 : 6 }}>
        {events.map((ev) => {
          const { name, color } = icon(ev);
          const claude = ev.kind === 'CLAUDE_ACTIVITY';
          return (
            <div
              key={ev.id}
              className="row items-start g2"
              style={{ fontSize: compact ? 12 : 13.5, opacity: claude ? 0.85 : 1 }}
            >
              <span
                style={{
                  color,
                  paddingTop: 2,
                  width: 14,
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <Icon name={name} size={14} />
              </span>
              <span
                className="flex-1 selectable pre-wrap"
                style={{ color: claude ? 'var(--text-muted)' : 'var(--text-primary)' }}
              >
                {ev.message}
              </span>
              <span className="t-caption tabular shrink-0">
                {new Date(ev.at).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
