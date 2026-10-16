import { Button, IconButton, Input, Switch } from '@offerpath/ui';

import type { TargetCompany } from '../types';

/**
 * The companies whose own careers sites the "Company careers" source
 * searches. Each one switched on is a separate Claude run per hunt.
 */
export function CompaniesEditor({
  value,
  onChange,
}: {
  value: TargetCompany[];
  onChange: (next: TargetCompany[]) => void;
}) {
  const set = (i: number, patch: Partial<TargetCompany>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const on = value.filter((c) => c.enabled).length;
  return (
    <div className="col g2">
      <p className="t-small text-muted" style={{ margin: 0 }}>
        {on} of {value.length} on. Each one switched on is searched on its own careers site in every
        hunt (one Claude run each), so keep the list to the companies you&apos;d really join.
      </p>
      {value.map((c, i) => (
        <div key={i} className="row g2 items-center">
          <Switch
            checked={c.enabled}
            onCheckedChange={(enabled) => set(i, { enabled })}
            aria-label={`Search ${c.name || 'this company'}`}
          />
          <Input
            size="sm"
            style={{ width: 180 }}
            aria-label="Company"
            value={c.name}
            placeholder="Company"
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <Input
            size="sm"
            className="flex-1"
            aria-label="Careers page"
            value={c.careersUrl}
            placeholder="https://careers.example.com/jobs"
            onChange={(e) => set(i, { careersUrl: e.target.value })}
          />
          <IconButton
            icon="trash"
            size="sm"
            variant="danger"
            label={`Remove ${c.name || 'company'}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          icon="plus"
          onClick={() => onChange([...value, { name: '', careersUrl: '', enabled: true }])}
        >
          Add a company
        </Button>
      </div>
    </div>
  );
}
