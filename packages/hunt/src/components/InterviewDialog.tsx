import { ConfirmDialog, Field, Input, Select, Textarea } from '@offerpath/ui';
import { useState } from 'react';

import { INTERVIEW_MODE_LABELS } from '../logic';
import { useRecordInterview } from '../queries';
import type { InterviewMode } from '../types';
import { ErrorBanner } from './common';

/** "Got an interview call": record when, how and what to prepare. */
export function InterviewDialog({
  open,
  onOpenChange,
  applicationId,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  company: string;
}) {
  const record = useRecordInterview();
  const [when, setWhen] = useState('');
  const [mode, setMode] = useState<InterviewMode | ''>('');
  const [round, setRound] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setWhen('');
    setMode('');
    setRound('');
    setContact('');
    setNotes('');
    record.reset();
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Got an interview call?"
      description={`Record the interview ${company} invited you to. Everything is optional; add what you know.`}
      confirmLabel="Record interview"
      loading={record.isPending}
      onConfirm={() =>
        record.mutate(
          {
            id: applicationId,
            interview: {
              scheduledAt: when ? new Date(when).toISOString() : null,
              mode,
              round: round.trim(),
              contact: contact.trim(),
              notes: notes.trim(),
            },
          },
          {
            onSuccess: () => {
              reset();
              onOpenChange(false);
            },
          },
        )
      }
    >
      <div className="col g3">
        <ErrorBanner error={record.error} />
        <Field label="When">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="How">
          <Select value={mode} onChange={(e) => setMode(e.target.value as InterviewMode | '')}>
            <option value="">Not sure yet</option>
            {Object.entries(INTERVIEW_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Round">
          <Input
            value={round}
            onChange={(e) => setRound(e.target.value)}
            placeholder="e.g. HR screening, Technical round 1"
          />
        </Field>
        <Field label="Who called">
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Name or team"
          />
        </Field>
        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What they said, what to prepare"
            rows={3}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
