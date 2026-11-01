import {
  BulletList,
  Button,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Spinner,
  Textarea,
} from '@offerpath/ui';
import { useState } from 'react';

import {
  ErrorAlert,
  PublishBadge,
  PublishSwitch,
  ReorderableList,
  SourceBadges,
  Toolbar,
} from '../components/common';
import { EditorDialog } from '../components/EditorDialog';
import { linesToList } from '../lib/format';
import { useCollection, useCreateItem, useDeleteItem, useReorder, useUpdateItem } from '../queries';
import type { CollectionPatch, ExperienceInput, ExperienceItem } from '../types';

import { FILTER_OPTIONS, applyFilter, type PublishFilter } from './Projects';

/** Experience: roles, in order. */
export function ExperienceSection() {
  const experience = useCollection('experience');
  const update = useUpdateItem('experience');
  const reorder = useReorder('experience');
  const [filter, setFilter] = useState<PublishFilter>('all');
  const [editing, setEditing] = useState<ExperienceItem | 'new' | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (experience.isLoading) return <Spinner label="Loading experience" />;
  if (experience.error) {
    return <ErrorAlert error={experience.error} fallback="Experience did not load." />;
  }
  const all = experience.data ?? [];
  const shown = applyFilter(all, filter);
  const patch = (item: ExperienceItem, body: CollectionPatch<'experience'>) => {
    setPendingId(item.id);
    update.mutate({ id: item.id, patch: body }, { onSettled: () => setPendingId(null) });
  };
  const nameOf = (e: ExperienceItem) => [e.title, e.company].filter(Boolean).join(' at ');

  return (
    <div>
      <Toolbar>
        <SegmentedControl
          label="Show experience"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
        />
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add experience
        </Button>
      </Toolbar>
      {update.error ? (
        <div className="mb4">
          <ErrorAlert error={update.error} />
        </div>
      ) : null}
      {reorder.error ? (
        <div className="mb4">
          <ErrorAlert error={reorder.error} fallback="The new order was not saved." />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title={all.length === 0 ? 'No experience yet' : 'Nothing here'}
          description={
            all.length === 0
              ? 'Experiences from your profile arrive here as drafts. You can also add one.'
              : 'No experience matches this filter.'
          }
        />
      ) : (
        <ReorderableList
          items={shown}
          label="Experience"
          nameOf={nameOf}
          disabled={filter !== 'all' || reorder.isPending}
          onReorder={(ids) => reorder.mutate(ids)}
        >
          {(item) => (
            <div className="pf-item">
              <div className="pf-item-text">
                <div className="row items-center g2 wrap">
                  <span className="t-h4">{item.title}</span>
                  <span className="t-small">{item.company}</span>
                  <PublishBadge published={item.published} />
                  <SourceBadges
                    source={item.source}
                    followsSource={item.followsSource}
                    onRelink={() => patch(item, { followsSource: true })}
                    relinking={pendingId === item.id && update.isPending}
                  />
                </div>
                {item.period ? <div className="t-caption">{item.period}</div> : null}
                <BulletList items={item.bullets.slice(0, 3)} empty="No bullets" />
                {item.bullets.length > 3 ? (
                  <div className="t-caption">+{item.bullets.length - 3} more</div>
                ) : null}
              </div>
              <div className="pf-item-actions">
                <PublishSwitch
                  name={nameOf(item)}
                  published={item.published}
                  pending={pendingId === item.id && update.isPending}
                  onChange={(published) => patch(item, { published })}
                />
                <Button
                  size="sm"
                  icon="pencil"
                  aria-label={`Edit ${nameOf(item)}`}
                  onClick={() => setEditing(item)}
                >
                  Edit
                </Button>
              </div>
            </div>
          )}
        </ReorderableList>
      )}
      {editing ? (
        <ExperienceEditor
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ExperienceEditor({ item, onClose }: { item: ExperienceItem | null; onClose: () => void }) {
  const create = useCreateItem('experience');
  const update = useUpdateItem('experience');
  const remove = useDeleteItem('experience');
  const [title, setTitle] = useState(item?.title ?? '');
  const [company, setCompany] = useState(item?.company ?? '');
  const [period, setPeriod] = useState(item?.period ?? '');
  const [bullets, setBullets] = useState((item?.bullets ?? []).join('\n'));
  const [errors, setErrors] = useState<{ title?: string; company?: string; period?: string }>({});

  const save = () => {
    const found: typeof errors = {};
    if (title.trim().length < 2) found.title = 'Add the role (at least 2 characters).';
    if (company.trim().length < 2) found.company = 'Add the company (at least 2 characters).';
    if (period.trim().length < 2) found.period = 'Add when, e.g. Jan 2023 – Present.';
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: ExperienceInput = {
      title: title.trim(),
      company: company.trim(),
      period: period.trim(),
      bullets: linesToList(bullets),
    };
    if (!item) {
      create.mutate(body, { onSuccess: onClose });
      return;
    }
    const changed: Partial<ExperienceInput> = {};
    for (const key of Object.keys(body) as (keyof ExperienceInput)[]) {
      if (JSON.stringify(body[key]) !== JSON.stringify(item[key])) {
        (changed as Record<string, unknown>)[key] = body[key];
      }
    }
    if (Object.keys(changed).length === 0) onClose();
    else update.mutate({ id: item.id, patch: changed }, { onSuccess: onClose });
  };

  return (
    <EditorDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={item ? 'Edit experience' : 'Add experience'}
      onSubmit={save}
      saving={create.isPending || update.isPending}
      error={create.error ?? update.error}
      itemName={item ? `${item.title} at ${item.company}` : undefined}
      onDelete={item ? () => remove.mutate(item.id, { onSuccess: onClose }) : undefined}
      deleting={remove.isPending}
      deleteError={remove.error}
    >
      <div className="grid grid-halves g4">
        <Field label="Title" required error={errors.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Company" required error={errors.company}>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
      </div>
      <Field label="Period" required hint="For example: Jan 2023 – Present" error={errors.period}>
        <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
      </Field>
      <Field label="Bullets" hint="One per line.">
        <Textarea rows={6} value={bullets} onChange={(e) => setBullets(e.target.value)} />
      </Field>
    </EditorDialog>
  );
}
