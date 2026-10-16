import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cx } from '../cx';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'subtle'
  | 'ghost'
  | 'danger'
  | 'solid-danger'
  | 'success'
  | 'highlight';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export function Spinner({
  size = 'md',
  label = 'Loading',
}: {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  return (
    <span
      className={cx('spinner', size !== 'md' && `spinner-${size}`)}
      role="status"
      aria-label={label}
    />
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Shows a spinner and disables the button while an action runs. */
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

const ICON_SIZE: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 15, lg: 16 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    loading = false,
    block,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  // Merged, not spread over: a `className` in `rest` would replace every class.
  const classes = cx(
    'btn',
    `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    block && 'btn-block',
    className,
  );
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="spinner" aria-hidden />
      ) : icon ? (
        <Icon name={icon} size={ICON_SIZE[size]} />
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: the button's accessible name, also shown as its tooltip. */
  label: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'danger';
  active?: boolean;
  loading?: boolean;
  /** Small count drawn on the corner (unread notifications). */
  count?: number;
  /** Set false to skip the hover tooltip. */
  tooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    size = 'md',
    variant = 'ghost',
    active,
    loading,
    count,
    tooltip = true,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(
        'icon-btn',
        size === 'sm' && 'icon-btn-sm',
        variant === 'danger' && 'icon-btn-danger',
        active && 'active',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="spinner spinner-sm" aria-hidden />
      ) : (
        <Icon name={icon} size={size === 'sm' ? 14 : 17} />
      )}
      {count ? (
        <span className="count-badge" aria-hidden>
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});
