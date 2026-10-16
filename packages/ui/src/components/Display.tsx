import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

// ---- Badges, tags, dots -----------------------------------------------------------------

export type BadgeVariant =
  'neutral' | 'primary' | 'highlight' | 'success' | 'warning' | 'error' | 'info' | 'solid-error';

export function Badge({
  children,
  variant = 'neutral',
  icon,
  size = 'md',
  title,
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  icon?: IconName;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={cx('badge', `badge-${variant}`, size === 'sm' && 'badge-sm', className)}
      title={title}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/** A status's tone; mapped to the badge colours below. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

const TONE_VARIANT: Record<Tone, BadgeVariant> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  accent: 'primary',
};

/** A labelled status pill. Domain packages map their statuses to a label and a tone. */
export function StatusBadge({
  label,
  tone = 'neutral',
  size = 'md',
}: {
  label: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md';
}) {
  return (
    <Badge variant={TONE_VARIANT[tone]} size={size}>
      {label}
    </Badge>
  );
}

export type TagTone = 'neutral' | 'primary' | 'success' | 'info' | 'warning';

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: TagTone }) {
  return <span className={cx('tag', tone !== 'neutral' && `tag-${tone}`)}>{children}</span>;
}

/** A short list of tags, cut off after `max` with a "+N more". */
export function Chips({
  items,
  tone = 'neutral',
  max = 12,
  empty = 'None',
}: {
  items: string[];
  tone?: TagTone;
  max?: number;
  empty?: ReactNode;
}) {
  if (!items.length) return <span className="t-small text-muted">{empty}</span>;
  return (
    <div className="tag-list">
      {items.slice(0, max).map((item) => (
        <Tag key={item} tone={tone}>
          {item}
        </Tag>
      ))}
      {items.length > max ? <span className="t-caption">+{items.length - max} more</span> : null}
    </div>
  );
}

export function BulletList({ items, empty = 'None listed' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="t-small text-muted">{empty}</span>;
  return (
    <ul className="bullets selectable">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export type DotTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export function Dot({
  tone = 'neutral',
  size = 'md',
  title,
}: {
  tone?: DotTone;
  size?: 'sm' | 'md';
  title?: string;
}) {
  return (
    <span
      className={cx('dot', size === 'sm' && 'dot-sm', tone !== 'neutral' && `dot-${tone}`)}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  );
}

// ---- Surfaces ---------------------------------------------------------------------------

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  hover?: boolean;
  flush?: boolean;
}

export function Card({ elevated, hover, flush, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        elevated ? 'card-elevated' : 'card',
        hover && 'card-hover',
        flush && 'card-flush',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A card with an optional heading and an action at the right of it. */
export function Panel({
  title,
  action,
  children,
  flush,
  className,
  style,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cx('card', flush && 'card-flush', className)} style={style}>
      {title || action ? (
        <div className="card-head">
          {title ? <h3 className="t-h4">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <div className="t-eyebrow mb1">{eyebrow}</div> : null}
        <h1 className="t-h1">{title}</h1>
        {subtitle ? (
          <div className="t-body mt1" style={{ maxWidth: 720 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

/** ForgeRoutine's section head: an eyebrow, a title, a description and an action. */
export function SectionHead({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <div className="row justify-between items-end mb6 g4 wrap">
      <div>
        {eyebrow && <div className="t-caption mb1">{eyebrow}</div>}
        <h1 className="t-h1">{title}</h1>
        {description && (
          <div className="t-body mt1" style={{ maxWidth: 640 }}>
            {description}
          </div>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

export type StatTone = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

const STAT_COLOR: Record<StatTone, string | undefined> = {
  default: undefined,
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
  info: 'var(--info)',
};

export function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="stat">
      <div className="kv-label">{label}</div>
      <div className="t-metric" style={{ color: STAT_COLOR[tone] }}>
        {value}
      </div>
    </div>
  );
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="kv-label">{label}</div>
      <div className="kv-value">{children}</div>
    </div>
  );
}

/**
 * Centred empty / loading / error block: there is nothing to fill the width
 * with, so the message sits in the middle.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  dashed = true,
}: {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
}) {
  return (
    <div className={cx('state-block', dashed && 'dashed')}>
      <div className="state-icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="t-h3">{title}</div>
      {description ? (
        <div className="t-body" style={{ maxWidth: 460 }}>
          {description}
        </div>
      ) : null}
      {action ? <div className="mt4">{action}</div> : null}
    </div>
  );
}

// ---- Alerts -----------------------------------------------------------------------------

export type AlertStatus = 'info' | 'success' | 'warning' | 'error';

const ALERT_ICON: Record<AlertStatus, IconName> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'alert',
  error: 'xCircle',
};

/**
 * A banner in the flow of the page. `details` adds a "Show developer details"
 * toggle (for errors carrying a technical explanation).
 */
export function Alert({
  status = 'info',
  title,
  children,
  details,
  actions,
  className,
}: {
  status?: AlertStatus;
  title?: ReactNode;
  children?: ReactNode;
  details?: string | null;
  actions?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cx('alert', `alert-${status}`, className)}
      role={status === 'error' ? 'alert' : 'status'}
    >
      <Icon name={ALERT_ICON[status]} size={17} />
      <div className="alert-body">
        {title ? <div className="alert-title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
        {actions || details ? (
          <div className="row g2 mt2 wrap">
            {actions}
            {details ? (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
              >
                {open ? 'Hide' : 'Show'} developer details
              </button>
            ) : null}
          </div>
        ) : null}
        {details && open ? <pre>{details}</pre> : null}
      </div>
    </div>
  );
}

// ---- Progress and scores ----------------------------------------------------------------

/** Green above 70, amber above 45, red below: a number to act on needs no legend. */
export function metricColor(pct: number): string {
  if (pct >= 70) return 'var(--success)';
  if (pct >= 45) return 'var(--warning)';
  return 'var(--error)';
}

const clamp = (pct: number) => Math.max(0, Math.min(100, pct));

export function ProgressBar({
  pct,
  thin,
  label,
}: {
  /** null shows an indeterminate bar. */
  pct: number | null;
  thin?: boolean;
  label?: string;
}) {
  return (
    <div
      className={cx('progress-linear', thin && 'thin', pct === null && 'indeterminate')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(clamp(pct))}
    >
      <div className="fill" style={{ width: `${pct === null ? 30 : clamp(pct)}%` }} />
    </div>
  );
}

export function SkillMeter({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="skill-meter">
      <div
        className="seg"
        style={{ width: `${clamp(pct)}%`, background: color ?? metricColor(pct) }}
      />
    </div>
  );
}

export function StatRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="mb3">
      <div className="stat-row mb1">
        <span className="t-small">{label}</span>
        <span className="t-code" style={{ fontWeight: 700, fontSize: 12.5 }}>
          {Math.round(pct)}%
        </span>
      </div>
      <SkillMeter pct={pct} />
    </div>
  );
}

/** How well a job matches the candidate, 0-100, or "Not analyzed". */
export function MatchScore({
  score,
  relevant,
  compact = false,
}: {
  score: number | null | undefined;
  relevant?: boolean | null;
  compact?: boolean;
}) {
  if (score === null || score === undefined) {
    return <span className="t-caption">Not analyzed</span>;
  }
  const color =
    relevant === false
      ? 'var(--text-muted)'
      : score >= 85
        ? 'var(--success)'
        : score >= 60
          ? 'var(--primary)'
          : 'var(--warning)';
  return (
    <span className={cx('match-score', compact && 'compact')} title={`Match ${score}%`}>
      <SkillMeter pct={score} color={color} />
      <span
        className="value"
        style={{ color: relevant === false ? 'var(--text-muted)' : undefined }}
      >
        {score}%
      </span>
    </span>
  );
}

export function CircularProgress({
  pct,
  size = 64,
  stroke = 6,
  color,
  label,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamp(pct) / 100) * circumference;
  return (
    <div className="circ" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--surface-2)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? metricColor(pct)}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset .6s var(--ease)' }}
        />
      </svg>
      <div className="circ-label">
        <span style={{ fontSize: size * 0.26, fontWeight: 800 }}>{Math.round(pct)}%</span>
        {label && (
          <span className="t-caption" style={{ marginTop: 1 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Marks output that came from a model. Never decorative: the user is
 * entitled to know which sentences the AI wrote.
 */
export function AiTag({ children = 'Claude' }: { children?: ReactNode }) {
  return (
    <div className="ai-tag">
      <span className="ai-mark">
        <Icon name="zap" size={10} />
      </span>
      {children}
    </div>
  );
}
