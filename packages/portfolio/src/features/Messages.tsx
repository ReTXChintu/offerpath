import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Spinner, cx } from '@offerpath/ui';
import { useState } from 'react';

import { ErrorAlert } from '../components/common';
import { formatDateTime } from '../lib/format';
import { useDeleteMessage, useMarkMessage, useMessages } from '../queries';
import type { MessageItem } from '../types';

/** Messages from the site's contact form, newest first. */
export function MessagesSection() {
  const messages = useMessages();
  const mark = useMarkMessage();
  const remove = useDeleteMessage();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MessageItem | null>(null);

  if (messages.isLoading) return <Spinner label="Loading messages" />;
  if (messages.error) {
    return <ErrorAlert error={messages.error} fallback="Messages did not load." />;
  }
  const items = [...(messages.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = items.filter((m) => !m.read).length;
  const open = items.find((m) => m.id === openId) ?? null;

  const view = (message: MessageItem) => {
    setOpenId(message.id);
    if (!message.read) mark.mutate({ id: message.id, read: true });
  };

  if (items.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="No messages yet"
        description="What visitors send through your site's contact form arrives here, and on your phone."
      />
    );
  }

  return (
    <div>
      <div className="t-small mb3">
        {unread ? `${unread} unread of ${items.length}` : `${items.length} messages, all read`}
      </div>
      {mark.error ? (
        <div className="mb4">
          <ErrorAlert error={mark.error} />
        </div>
      ) : null}
      {remove.error ? (
        <div className="mb4">
          <ErrorAlert error={remove.error} fallback="That did not delete. Try again." />
        </div>
      ) : null}
      <ul className="pf-list" aria-label="Messages">
        {items.map((message) => (
          <li key={message.id}>
            <button
              type="button"
              className={cx('list-row pf-message', !message.read && 'pf-message-unread')}
              onClick={() => view(message)}
              aria-label={`${message.read ? '' : 'Unread: '}message from ${message.name}`}
            >
              <span className="pf-message-from">
                {!message.read ? (
                  <Badge variant="primary" size="sm">
                    New
                  </Badge>
                ) : null}
                <span className="truncate">{message.name}</span>
                <span className="t-caption truncate">{message.email}</span>
              </span>
              <span className="pf-message-preview truncate">{message.message}</span>
              <span className="t-caption shrink-0">{formatDateTime(message.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <Dialog
          open
          onOpenChange={(o) => (o ? undefined : setOpenId(null))}
          title={`From ${open.name}`}
          description={`${open.email} · ${formatDateTime(open.createdAt)}`}
          size="md"
          footerSpread
          footer={
            <>
              <Button variant="danger" icon="trash" onClick={() => setDeleting(open)}>
                Delete
              </Button>
              <div className="row g2">
                <Button
                  variant="ghost"
                  icon="mail"
                  disabled={mark.isPending}
                  onClick={() => {
                    mark.mutate({ id: open.id, read: false });
                    setOpenId(null);
                  }}
                >
                  Mark unread
                </Button>
                <a
                  className="btn btn-primary"
                  href={`mailto:${open.email}?subject=${encodeURIComponent('Re: your message')}`}
                >
                  Reply by email
                </a>
              </div>
            </>
          }
        >
          <p className="pre-wrap selectable">{open.message}</p>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => (o ? undefined : setDeleting(null))}
        title="Delete this message?"
        description={
          deleting ? `The message from ${deleting.name} is deleted for good.` : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          remove.mutate(id, {
            onSuccess: () => {
              if (openId === id) setOpenId(null);
            },
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </div>
  );
}
