import {
  Alert,
  Button,
  Icon,
  IconButton,
  Input,
  Spinner,
  StatusBadge,
  type AlertStatus,
} from '@offerpath/ui';
import { useId, type MouseEvent, type ReactNode } from 'react';

import { errorDetails, errorMessage, useHuntNavigator, type HuntTarget } from '../client';
import { STATUS_LABELS, statusTone, type LocationOption } from '../logic';
import type { ApplicationStatus, JobStatus } from '../types';

/** A command's failure, with its technical details behind a toggle. */
export function ErrorBanner({
  error,
  title = 'Something went wrong',
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  if (!error) return null;
  return (
    <Alert
      status="error"
      title={title}
      details={errorDetails(error)}
      actions={
        onRetry ? (
          <Button size="xs" variant="subtle" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {errorMessage(error)}
    </Alert>
  );
}

export function InfoBanner({
  status = 'info',
  title,
  children,
}: {
  status?: AlertStatus;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Alert status={status} title={title}>
      {children}
    </Alert>
  );
}

/** A centred spinner for a page or panel that is still loading. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row justify-center p6">
      <Spinner label={label} />
    </div>
  );
}

/** A link to one of the hunt's places, through the host's router. */
export function HuntLink({
  to,
  children,
  className = 'link',
  title,
}: {
  to: HuntTarget;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const nav = useHuntNavigator();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    nav.navigate(to);
  };
  return (
    <a href={nav.href(to)} onClick={onClick} className={className} title={title}>
      {children}
    </a>
  );
}

/** A job's or an application's status, with Job Hunter's labels and tones. */
export function HuntStatusBadge({
  status,
  size = 'md',
}: {
  status: JobStatus | ApplicationStatus;
  size?: 'sm' | 'md';
}) {
  return (
    <StatusBadge label={STATUS_LABELS[status] ?? status} tone={statusTone(status)} size={size} />
  );
}

/**
 * Filter a list by place. Type any part of a location ("mumbai" matches
 * "Mumbai, Maharashtra") or pick one of the places already in the
 * database, listed with how many jobs each. Searches only what's stored,
 * never the web.
 */
export function LocationFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: LocationOption[];
}) {
  const listId = useId();
  return (
    <div className="row items-center g1">
      <span className="text-muted">
        <Icon name="mapPin" size={14} />
      </span>
      <Input
        size="sm"
        style={{ maxWidth: 190 }}
        list={listId}
        placeholder="Any location"
        aria-label="Location"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Only looks through the jobs already found"
      />
      <datalist id={listId}>
        {options.slice(0, 60).map((o) => (
          <option key={o.label} value={o.label}>
            {o.count === 1 ? '1 job' : `${o.count} jobs`}
          </option>
        ))}
      </datalist>
      {value ? (
        <IconButton icon="x" size="sm" label="Clear location" onClick={() => onChange('')} />
      ) : null}
    </div>
  );
}
