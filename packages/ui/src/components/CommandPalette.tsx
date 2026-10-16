import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';

import { cx } from '../cx';
import { Kbd } from './Display';
import { Icon, type IconName } from './Icon';

export interface Command {
  id: string;
  label: string;
  group?: string;
  icon?: IconName;
  /** Extra words that should find this command. */
  keywords?: string;
  /** Shown on the right, e.g. a shortcut. */
  hint?: string;
  onSelect: () => void;
}

function matches(command: Command, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${command.label} ${command.group ?? ''} ${command.keywords ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * Cmd/Ctrl-K: type to filter, arrows to move, Enter to run. A combobox with
 * a listbox, inside a Radix dialog so focus is trapped and Escape closes it.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = 'Search pages and actions…',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const results = useMemo(() => commands.filter((c) => matches(c, query)), [commands, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => setSelected(0), [query]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onOpenChange(false);
    command.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[selected]);
    }
  };

  let lastGroup: string | undefined;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog dialog-top cmdk" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="cmdk-input">
            <Icon name="search" size={17} />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[selected] ? `${listId}-${selected}` : undefined}
              aria-label="Search pages and actions"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <Kbd>Esc</Kbd>
          </div>
          <div className="cmdk-list" id={listId} role="listbox" aria-label="Results">
            {results.length === 0 ? <div className="cmdk-empty">Nothing matches.</div> : null}
            {results.map((command, i) => {
              const header = command.group && command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                <div key={command.id}>
                  {header ? (
                    <div className="cmdk-group" aria-hidden>
                      {header}
                    </div>
                  ) : null}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === selected}
                    className={cx('cmdk-item', i === selected && 'sel')}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => run(command)}
                  >
                    {command.icon ? <Icon name={command.icon} size={16} /> : null}
                    <span>{command.label}</span>
                    {command.hint ? (
                      <span className="kbd-hint t-caption">{command.hint}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Opens the palette on Cmd-K (macOS) or Ctrl-K (elsewhere). */
export function useCommandPaletteShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}
