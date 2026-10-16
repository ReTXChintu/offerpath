import * as ToastPrimitive from '@radix-ui/react-toast';
import { useSyncExternalStore } from 'react';

import { Icon, type IconName } from './Icon';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  type?: ToastType;
  title: string;
  description?: string;
  /** Milliseconds before it hides itself (default 6s). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'type' | 'title'>> {
  id: number;
  description?: string;
  duration: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Show a toast from anywhere (a mutation's onSuccess, an event handler).
 * `<Toaster />` must be mounted once at the root to display them.
 */
export const toast = {
  show(options: ToastOptions): number {
    const id = nextId++;
    items = [
      ...items,
      {
        id,
        type: options.type ?? 'info',
        title: options.title,
        description: options.description,
        duration: options.duration ?? 6000,
      },
    ].slice(-5);
    emit();
    return id;
  },
  dismiss(id: number) {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => items;

const TOAST_ICON: Record<ToastType, IconName> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'alert',
  error: 'xCircle',
};

const TOAST_COLOR: Record<ToastType, string> = {
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
};

/** Renders the toasts (Radix Toast: announced to screen readers, F8 focuses them). */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {list.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          className={`toast toast-${t.type}`}
          duration={t.duration}
          type={t.type === 'error' ? 'foreground' : 'background'}
          onOpenChange={(open) => {
            if (!open) toast.dismiss(t.id);
          }}
        >
          <span style={{ color: TOAST_COLOR[t.type], marginTop: 1 }}>
            <Icon name={TOAST_ICON[t.type]} size={16} />
          </span>
          <div className="flex-1">
            <ToastPrimitive.Title className="toast-title">{t.title}</ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="toast-description">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close className="icon-btn icon-btn-sm" aria-label="Dismiss">
            <Icon name="x" size={13} />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="toast-viewport" />
    </ToastPrimitive.Provider>
  );
}
