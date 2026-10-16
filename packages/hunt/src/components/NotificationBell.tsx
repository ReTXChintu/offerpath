import { Button, IconButton, Popover } from '@offerpath/ui';
import { useState } from 'react';

import { useHuntNavigator, type HuntTarget } from '../client';
import { formatDateTime } from '../logic';
import { useMarkNotificationsRead, useNotifications } from '../queries';
import type { Notification } from '../types';

const LEVEL_COLOR: Record<Notification['level'], string> = {
  INFO: 'var(--info)',
  SUCCESS: 'var(--success)',
  WARN: 'var(--warning)',
  ERROR: 'var(--error)',
};

/** Where a notification leads. */
export function notificationTarget(n: Pick<Notification, 'linkPage' | 'linkId'>): HuntTarget {
  switch (n.linkPage) {
    case 'application':
      return n.linkId ? { to: 'application', applicationId: n.linkId } : { to: 'applications' };
    case 'applications':
      return { to: 'applications' };
    case 'job-sites':
      return { to: 'job-sites' };
    case 'jobs':
      return { to: 'jobs' };
    default:
      return { to: 'agent' };
  }
}

/** What the agent wants you to know: finished hunts, things that need you, failures. */
export function NotificationBell() {
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();
  const nav = useHuntNavigator();
  const [open, setOpen] = useState(false);
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;

  const openItem = (n: Notification) => {
    if (!n.read) markRead.mutate([n.id]);
    setOpen(false);
    nav.navigate(notificationTarget(n));
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={370}
      label="Notifications"
      trigger={
        <IconButton
          icon="bell"
          label={unread ? `${unread} unread notifications` : 'Notifications'}
          count={unread}
          tooltip={false}
        />
      }
    >
      <div
        className="row items-center justify-between"
        style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}
      >
        <strong style={{ fontSize: 13.5 }}>Notifications</strong>
        {unread ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => markRead.mutate(undefined)}
            loading={markRead.isPending}
          >
            Mark all read
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p
          className="t-small text-muted"
          style={{ padding: '24px 16px', textAlign: 'center', margin: 0 }}
        >
          Nothing yet. You&apos;ll hear here, in Windows, on your phone and on the web when a job
          hunt finishes or something needs you.
        </p>
      ) : (
        <div className="scroll-y" style={{ maxHeight: 420 }}>
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              className={n.read ? 'notif' : 'notif unread'}
              onClick={() => openItem(n)}
            >
              <span
                className="dot dot-sm"
                style={{ background: LEVEL_COLOR[n.level], marginTop: 6 }}
                aria-hidden
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: n.read ? 400 : 650 }}>
                  {n.title}
                </span>
                {n.body ? (
                  <span className="t-small text-muted" style={{ display: 'block' }}>
                    {n.body}
                  </span>
                ) : null}
                <span className="t-caption" style={{ display: 'block', marginTop: 2 }}>
                  {formatDateTime(n.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
