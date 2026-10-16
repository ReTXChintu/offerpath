import * as SwitchPrimitive from '@radix-ui/react-switch';
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cx } from '../cx';
import { Icon } from './Icon';

// ---- Field: label + control + hint/error, wired for screen readers ----------------------

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control takes from the Field around it, unless it sets its own. */
function useFieldProps(props: { id?: string; 'aria-describedby'?: string }) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    'aria-describedby': props['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': field?.invalid || undefined,
    invalid: field?.invalid ?? false,
  };
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  /** An error message; marks the control invalid. `true` marks it without a message. */
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasMessage = error !== undefined && error !== null && error !== false && error !== true;
  const describedBy = [hasMessage ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <FieldContext.Provider
      value={{
        id,
        describedBy: describedBy || undefined,
        invalid: !!error,
        required: !!required,
      }}
    >
      <div className={cx('field', className)}>
        {label ? (
          <label className="field-label" htmlFor={id}>
            {label}
            {required ? (
              <span className="required" aria-hidden>
                {' '}
                *
              </span>
            ) : null}
          </label>
        ) : null}
        {children}
        {hasMessage ? (
          <div className="field-error" id={errorId}>
            {error}
          </div>
        ) : null}
        {hint ? (
          <div className="field-hint" id={hintId}>
            {hint}
          </div>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

// ---- Text inputs ----------------------------------------------------------------------------

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', ...rest },
  ref,
) {
  const field = useFieldProps(rest);
  const { invalid, ...aria } = field;
  return (
    <input
      ref={ref}
      {...rest}
      {...aria}
      className={cx('input', size === 'sm' && 'input-sm', invalid && 'has-error', className)}
    />
  );
});

/**
 * A password (or any secret: API keys, SMTP passwords) with an eye button
 * that shows or hides it. Required on every secret field in Offerpath.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  function PasswordInput({ className, size = 'md', ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    const field = useFieldProps(rest);
    const { invalid, ...aria } = field;
    return (
      <div className="input-group">
        <input
          ref={ref}
          autoComplete="current-password"
          {...rest}
          {...aria}
          type={visible ? 'text' : 'password'}
          className={cx('input', size === 'sm' && 'input-sm', invalid && 'has-error', className)}
        />
        <button
          type="button"
          className="icon-btn icon-btn-sm input-addon"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={aria.id}
          title={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
          disabled={rest.disabled}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={15} />
        </button>
      </div>
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  const field = useFieldProps(rest);
  const { invalid, ...aria } = field;
  return (
    <textarea
      ref={ref}
      rows={3}
      {...rest}
      {...aria}
      className={cx('textarea', invalid && 'has-error', className)}
    />
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md';
  /** Stretch to the container's width (the default inside a Field). */
  block?: boolean;
}

/** A native select: the most accessible choice for a short list. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size = 'md', block, ...rest },
  ref,
) {
  const inField = useContext(FieldContext) !== null;
  const field = useFieldProps(rest);
  const { invalid, ...aria } = field;
  return (
    <select
      ref={ref}
      {...rest}
      {...aria}
      className={cx(
        'select',
        size === 'sm' && 'select-sm',
        (block ?? inField) && 'w-full',
        invalid && 'has-error',
        className,
      )}
    />
  );
});

// ---- Choices --------------------------------------------------------------------------------

export function Checkbox({
  checked,
  onCheckedChange,
  children,
  disabled,
  className,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <label className={cx('checkbox-row', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        {...rest}
      />
      {children ? <span>{children}</span> : null}
    </label>
  );
}

/** An on/off setting (Radix Switch) with its label. */
export function Switch({
  checked,
  onCheckedChange,
  children,
  disabled,
  className,
  title,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
}) {
  const id = useId();
  return (
    <div className={cx('switch-row', disabled && 'disabled', className)} title={title}>
      <SwitchPrimitive.Root
        id={id}
        className="switch"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        {...rest}
      >
        <SwitchPrimitive.Thumb className="switch-thumb" />
      </SwitchPrimitive.Root>
      {children ? <label htmlFor={id}>{children}</label> : null}
    </div>
  );
}

/** A few mutually exclusive options shown side by side (a radio group). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  label: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Lists of strings -----------------------------------------------------------------------

function splitItems(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i);
}

/** Comma / Enter separated tags for a list of strings (skills, roles, places). */
export function TagInput({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState('');
  const field = useFieldProps({});
  const commit = () => {
    const items = splitItems(draft);
    if (items.length) onChange([...value, ...items.filter((i) => !value.includes(i))]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="tag-input">
      {value.map((item) => (
        <span key={item} className="tag">
          <span className="truncate">{item}</span>
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => onChange(value.filter((v) => v !== item))}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <input
        id={field.id}
        aria-describedby={field['aria-describedby']}
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholder ?? 'Type and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
      />
    </div>
  );
}

/** One item per line; leading bullets are dropped. */
export function LinesInput({
  value,
  onChange,
  placeholder,
  rows = 4,
  'aria-label': ariaLabel,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  rows?: number;
  'aria-label'?: string;
}) {
  return (
    <Textarea
      rows={rows}
      aria-label={ariaLabel}
      value={value.join('\n')}
      placeholder={placeholder ?? 'One item per line'}
      onChange={(e) =>
        onChange(
          e.target.value
            .split('\n')
            .map((s) => s.replace(/^[-•*]\s*/, ''))
            .filter((line, i, arr) => i < arr.length - 1 || line.length > 0),
        )
      }
    />
  );
}
