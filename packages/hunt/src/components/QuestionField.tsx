import { Input, Select, Textarea } from '@offerpath/ui';
import { useId } from 'react';

import type { PendingQuestion } from '../types';

/** One question a website asked that only the user can answer. */
export function QuestionField({
  q,
  value,
  onChange,
}: {
  q: PendingQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const label = (
    <label htmlFor={id} className="field-label" style={{ color: 'var(--text-primary)' }}>
      {q.question}
      {q.required ? <span className="required"> *</span> : null}
      {q.context ? (
        <span className="text-muted" style={{ fontWeight: 400 }}>
          {' '}
          — {q.context}
        </span>
      ) : null}
    </label>
  );
  if ((q.fieldType === 'select' || q.fieldType === 'radio') && q.options.length) {
    return (
      <div className="field">
        {label}
        <Select
          id={id}
          block
          size="sm"
          required={q.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </div>
    );
  }
  if (q.fieldType === 'textarea') {
    return (
      <div className="field">
        {label}
        <Textarea
          id={id}
          rows={3}
          required={q.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="field">
      {label}
      <Input
        id={id}
        size="sm"
        required={q.required}
        type={q.fieldType === 'number' ? 'number' : q.fieldType === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
