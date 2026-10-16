import { Panel, SkillMeter } from '@offerpath/ui';

export interface FunnelCounts {
  found: number;
  relevant: number;
  applied: number;
  interviews: number;
  offers: number;
}

const STAGES: { key: keyof FunnelCounts; label: string }[] = [
  { key: 'found', label: 'Jobs found' },
  { key: 'relevant', label: 'Good matches' },
  { key: 'applied', label: 'Applied' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'offers', label: 'Offers' },
];

/**
 * The hunt's funnel, from jobs found to offers, for the Progress page. The
 * host works the counts out (the desktop from its own store, the web from
 * what the desktop synced).
 */
export function FunnelPanel({ counts, note }: { counts: FunnelCounts | null; note?: string }) {
  const top = Math.max(1, counts?.found ?? 0);
  return (
    <Panel title="The hunt">
      {counts ? (
        <div className="col g3" aria-label="Hunt funnel">
          {STAGES.map((stage) => (
            <div key={stage.key}>
              <div className="stat-row mb1">
                <span className="t-small">{stage.label}</span>
                <span className="t-code" style={{ fontWeight: 700, fontSize: 12.5 }}>
                  {counts[stage.key]}
                </span>
              </div>
              <SkillMeter pct={(counts[stage.key] / top) * 100} color="var(--primary)" />
            </div>
          ))}
        </div>
      ) : (
        <div className="t-small">The hunt&apos;s numbers appear here once it has run.</div>
      )}
      {note ? <div className="t-caption mt3">{note}</div> : null}
    </Panel>
  );
}
