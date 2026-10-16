import { Button, Icon, IconButton, Panel } from '@offerpath/ui';

import { timeAgo } from '../logic';
import { useClearQueue, useQueue, useRemoveQueuedTask } from '../queries';

/** What's waiting for the agent, in the order it will run. */
export function QueuePanel() {
  const queue = useQueue();
  const remove = useRemoveQueuedTask();
  const clear = useClearQueue();
  const items = queue.data ?? [];
  return (
    <Panel
      title={`Queue${items.length ? ` (${items.length})` : ''}`}
      action={
        items.length > 1 ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => clear.mutate()}
            loading={clear.isPending}
          >
            Clear all
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="t-small text-muted" style={{ margin: 0 }}>
          Nothing waiting. Start anything while the agent is busy and it lines up here, then runs by
          itself as soon as the agent is free.
        </p>
      ) : (
        <ol className="col" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((item, i) => (
            <li
              key={item.id}
              className="row items-center justify-between g3"
              style={{ padding: '6px 0', borderTop: i ? '1px solid var(--border)' : undefined }}
            >
              <div className="row items-center g3" style={{ minWidth: 0 }}>
                <Icon name="listOrdered" size={14} />
                <span className="truncate" style={{ fontWeight: 550 }}>
                  {i + 1}. {item.title}
                </span>
                <span className="t-caption shrink-0">added {timeAgo(item.requestedAt)}</span>
              </div>
              <IconButton
                icon="x"
                size="sm"
                label={`Remove ${item.title} from the queue`}
                onClick={() => remove.mutate(item.id)}
                loading={remove.isPending && remove.variables === item.id}
              />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
