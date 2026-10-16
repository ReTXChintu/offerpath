import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactElement, ReactNode } from 'react';

import { cx } from '../cx';
import { Button } from './Button';
import { Icon } from './Icon';

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** An element that opens the dialog when clicked (uncontrolled use). */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Put the footer's first item on the left (an extra action). */
  footerSpread?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the corner close button (the footer has its own). */
  hideClose?: boolean;
  /** Keep the dialog open when the overlay is clicked (a form with unsaved input). */
  dismissable?: boolean;
  className?: string;
}

/**
 * A modal dialog (Radix Dialog): focus is trapped inside, Escape and the
 * close button close it, and focus returns to what opened it.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  footerSpread,
  size = 'sm',
  hideClose,
  dismissable = true,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={cx('dialog', size !== 'sm' && `dialog-${size}`, className)}
          onPointerDownOutside={dismissable ? undefined : (e) => e.preventDefault()}
          // Radix warns without a description; an explicit undefined opts out.
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="dialog-description">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children ? <div className="dialog-body">{children}</div> : null}
          {footer ? (
            <div className={cx('dialog-footer', footerSpread && 'spread')}>{footer}</div>
          ) : null}
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="icon-btn icon-btn-sm dialog-close"
                aria-label="Close"
              >
                <Icon name="x" size={15} />
              </button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Closes the dialog it sits in; wraps a footer button. */
export const DialogClose = DialogPrimitive.Close;

/** "Are you sure?" with Cancel and a confirm button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  children,
  size,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size={size}
      hideClose
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'solid-danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
