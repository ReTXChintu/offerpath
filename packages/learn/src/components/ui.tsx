import {
  Badge as UiBadge,
  Button as UiButton,
  Icon as UiIcon,
  type ButtonProps,
  type IconName,
  type IconProps,
} from '@offerpath/ui';
import type { ComponentProps, ReactNode } from 'react';

/**
 * ForgeRoutine's page helpers on @offerpath/ui.
 *
 * @offerpath/ui was built from ForgeRoutine's design system and keeps its
 * class names, so most helpers are re-exported as they are. The few whose
 * shape differs keep ForgeRoutine's here, so the pages moved over unchanged.
 */
export {
  AiTag,
  Card,
  CircularProgress,
  ProgressBar,
  SectionHead,
  SkillMeter,
  StatRow,
  metricColor,
  type BadgeVariant,
} from '@offerpath/ui';

/** ForgeRoutine's icons took any string; names here are @offerpath/ui's (a superset). */
export function Icon({ name, ...rest }: Omit<IconProps, 'name'> & { name: string }) {
  return <UiIcon name={name as IconName} {...rest} />;
}

export function Badge({
  icon,
  ...rest
}: Omit<ComponentProps<typeof UiBadge>, 'icon'> & { icon?: string }) {
  return <UiBadge icon={icon as IconName | undefined} {...rest} />;
}

/** ForgeRoutine's buttons were primary unless told otherwise. */
export function Button({
  variant = 'primary',
  size,
  icon,
  ...rest
}: Omit<ButtonProps, 'icon' | 'size'> & { icon?: string; size?: 'sm' | 'lg' }) {
  return <UiButton variant={variant} size={size} icon={icon as IconName | undefined} {...rest} />;
}

/** Centred empty / error block. */
export function StateBlock({
  icon: iconName,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      <div className="state-icon">
        <Icon name={iconName} size={22} />
      </div>
      <div className="t-h3">{title}</div>
      {body && (
        <div className="t-body" style={{ maxWidth: 420 }}>
          {body}
        </div>
      )}
      {action && <div className="mt4">{action}</div>}
    </div>
  );
}

/** A loading placeholder: a skeleton bar, with what is loading under it. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="state-block" role="status" aria-label={label ?? 'Loading'}>
      <div className="skeleton" style={{ width: 180, height: 10, borderRadius: 99 }} />
      {label && <div className="t-caption mt3">{label}</div>}
    </div>
  );
}

/** ForgeRoutine's simple tab strip: plain labels, one active. */
export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: readonly string[];
  active: string;
  onChange: (tab: string) => void;
  className?: string;
}) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={tab === active}
          key={tab}
          className={`tab ${tab === active ? 'active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
