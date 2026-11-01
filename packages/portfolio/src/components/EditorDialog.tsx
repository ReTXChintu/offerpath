import { Button, ConfirmDialog, Dialog } from '@offerpath/ui';
import { useState, type FormEvent, type ReactNode } from 'react';

import { ErrorAlert } from './common';

/**
 * The add / edit dialog every Portfolio collection uses: a form, Save and
 * Cancel, and Delete (behind a confirmation) for a saved item.
 */
export function EditorDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  saving,
  error,
  onDelete,
  deleting,
  deleteError,
  itemName,
  submitLabel = 'Save',
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  onSubmit: () => void;
  saving?: boolean;
  error?: unknown;
  /** Present for a saved item. */
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: unknown;
  /** Named in the delete confirmation. */
  itemName?: string;
  submitLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const formId = `pf-editor-${title.replace(/\W+/g, '-').toLowerCase()}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        size={size}
        dismissable={false}
        footerSpread={!!onDelete}
        footer={
          <>
            {onDelete ? (
              <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            ) : null}
            <div className="row g2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" form={formId} variant="primary" icon="save" loading={saving}>
                {submitLabel}
              </Button>
            </div>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="col g4" noValidate>
          {children}
          <ErrorAlert error={error} />
          <ErrorAlert error={deleteError} fallback="That did not delete. Try again." />
        </form>
      </Dialog>
      {onDelete ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete ${itemName ? `“${itemName}”` : 'this item'}?`}
          description="It is removed from your portfolio site. An item from your profile is not brought back by the next import."
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={() => {
            onDelete();
            setConfirming(false);
          }}
        />
      ) : null}
    </>
  );
}
