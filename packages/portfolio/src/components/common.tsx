import { copyText, describeError } from '@offerpath/learn';
import { Alert, Badge, Button, Field, Icon, IconButton, Input, Switch, cx } from '@offerpath/ui';
import { useState, type DragEvent, type ReactNode } from 'react';

import { isHexColour, moveId, moveIdTo, normaliseHex } from '../lib/format';
import type { Source } from '../types';

/** A failed request, with the server's problem `detail` when it sent one. */
export function ErrorAlert({ error, fallback }: { error: unknown; fallback?: string }) {
  if (!error) return null;
  return <Alert status="error">{describeError(error, fallback)}</Alert>;
}

/** Copies a value and says so honestly ("Copied" only when it landed). */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      size="sm"
      icon={state === 'copied' ? 'check' : 'copy'}
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? 'copied' : 'failed');
          window.setTimeout(() => setState('idle'), 2000);
        });
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}

/**
 * Where an item came from: "From profile", and whether its text still
 * follows the profile item. An edited one can be re-linked.
 */
export function SourceBadges({
  source,
  followsSource,
  onRelink,
  relinking,
}: {
  source: Source;
  followsSource: boolean;
  onRelink?: () => void;
  relinking?: boolean;
}) {
  if (!source) return null;
  return (
    <span className="row items-center g2 wrap">
      <Badge variant="info" icon="user" size="sm">
        From profile
      </Badge>
      {followsSource ? (
        <Badge variant="success" size="sm" title="Its text updates when the profile item changes">
          Following profile
        </Badge>
      ) : (
        <>
          <Badge size="sm" title="Edited here, so the profile no longer updates its text">
            Edited
          </Badge>
          {onRelink ? (
            <Button size="xs" variant="ghost" icon="link" onClick={onRelink} loading={relinking}>
              Re-link
            </Button>
          ) : null}
        </>
      )}
    </span>
  );
}

/** Draft or Published, as a badge. */
export function PublishBadge({ published }: { published: boolean }) {
  return published ? (
    <Badge variant="success" size="sm">
      Published
    </Badge>
  ) : (
    <Badge variant="warning" size="sm">
      Draft
    </Badge>
  );
}

/** The publish switch; disabled with a reason when publishing isn't possible yet. */
export function PublishSwitch({
  name,
  published,
  onChange,
  disabledReason,
  pending,
}: {
  name: string;
  published: boolean;
  onChange: (published: boolean) => void;
  disabledReason?: string | null;
  pending?: boolean;
}) {
  return (
    <span className="col items-end g1">
      <Switch
        checked={published}
        onCheckedChange={onChange}
        disabled={!!disabledReason || pending}
        aria-label={`Publish ${name}`}
        title={disabledReason ?? undefined}
      >
        Publish
      </Switch>
      {disabledReason ? <span className="t-caption">{disabledReason}</span> : null}
    </span>
  );
}

/**
 * A `#rrggbb` colour: the native picker plus the hex as text. A bad hex is
 * shown as an error and the picker keeps the last good colour.
 */
export function ColourField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const valid = normaliseHex(value);
  const problem = error ?? (value && !isHexColour(value) ? 'Use a colour like #1a2b3c.' : null);
  return (
    <Field label={label} error={problem ?? undefined}>
      <div className="row items-center g2">
        <input
          type="color"
          className="pf-colour-swatch"
          aria-label={`${label} picker`}
          value={valid ?? '#000000'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="#1a2b3c"
          spellCheck={false}
          maxLength={7}
          className="mono"
        />
      </div>
    </Field>
  );
}

/** How a card looks on the site: the gradient, the accent and the image. */
export function GradientPreview({
  title,
  subtitle,
  accent,
  gradientFrom,
  gradientTo,
  imageUrl,
}: {
  title: string;
  subtitle?: string;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  imageUrl?: string | null;
}) {
  const from = normaliseHex(gradientFrom) ?? '#1f2937';
  const to = normaliseHex(gradientTo) ?? '#111827';
  const accentColour = normaliseHex(accent) ?? '#6366f1';
  return (
    <div
      className="pf-preview"
      data-testid="gradient-preview"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-label="Card preview"
      role="img"
    >
      {imageUrl ? <img src={imageUrl} alt="" className="pf-preview-image" /> : null}
      <div className="pf-preview-body">
        <span className="pf-preview-accent" style={{ background: accentColour }} />
        <div className="pf-preview-title">{title || 'Untitled'}</div>
        {subtitle ? <div className="pf-preview-subtitle">{subtitle}</div> : null}
      </div>
    </div>
  );
}

/**
 * A list the user can put in order: drag a row by its handle, or use the
 * up and down buttons (the keyboard way). `onReorder` gets every id in the
 * new order.
 */
export function ReorderableList<T extends { id: string }>({
  items,
  label,
  nameOf,
  onReorder,
  disabled,
  children,
}: {
  items: T[];
  /** What the list is, for screen readers ("Projects"). */
  label: string;
  nameOf: (item: T) => string;
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  children: (item: T) => ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ids = items.map((item) => item.id);

  const move = (id: string, delta: -1 | 1) => {
    const next = moveId(ids, id, delta);
    if (next !== ids) onReorder(next);
  };
  const drop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    const id = dragging ?? e.dataTransfer.getData('text/plain');
    setDragging(null);
    setOver(null);
    if (!id) return;
    const next = moveIdTo(ids, id, targetId);
    if (next !== ids) onReorder(next);
  };

  return (
    <ul className="pf-list" aria-label={label}>
      {items.map((item, index) => {
        const name = nameOf(item) || 'Untitled';
        return (
          <li
            key={item.id}
            className={cx(
              'pf-row card',
              dragging === item.id && 'pf-row-dragging',
              over === item.id && dragging !== item.id && 'pf-row-over',
            )}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(item.id);
            }}
            onDragLeave={() => setOver((o) => (o === item.id ? null : o))}
            onDrop={(e) => drop(e, item.id)}
          >
            <div className="pf-row-order">
              <span
                className="pf-grip"
                draggable={!disabled}
                title="Drag to reorder"
                aria-hidden
                onDragStart={(e) => {
                  setDragging(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <Icon name="grip" size={16} />
              </span>
              <IconButton
                icon="arrowUp"
                size="sm"
                label={`Move ${name} up`}
                tooltip={false}
                disabled={disabled || index === 0}
                onClick={() => move(item.id, -1)}
              />
              <IconButton
                icon="arrowDown"
                size="sm"
                label={`Move ${name} down`}
                tooltip={false}
                disabled={disabled || index === items.length - 1}
                onClick={() => move(item.id, 1)}
              />
            </div>
            <div className="pf-row-main">{children(item)}</div>
          </li>
        );
      })}
    </ul>
  );
}

/** A section's toolbar: a filter on the left, the add button on the right. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="row items-center justify-between g3 wrap mb4">{children}</div>;
}
