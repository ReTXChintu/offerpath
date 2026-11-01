import {
  Button,
  Chips,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Spinner,
  TagInput,
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
import { useCollection, useCreateItem, useDeleteItem, useReorder, useUpdateItem } from '../queries';
import type { CollectionPatch, SkillGroupInput, SkillGroupItem } from '../types';

import { FILTER_OPTIONS, applyFilter, type PublishFilter } from './Projects';

/** Skills: groups of skills under a category, in order. */
export function SkillsSection() {
  const skills = useCollection('skills');
  const update = useUpdateItem('skills');
  const reorder = useReorder('skills');
  const [filter, setFilter] = useState<PublishFilter>('all');
  const [editing, setEditing] = useState<SkillGroupItem | 'new' | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (skills.isLoading) return <Spinner label="Loading skills" />;
  if (skills.error) return <ErrorAlert error={skills.error} fallback="Skills did not load." />;
  const all = skills.data ?? [];
  const shown = applyFilter(all, filter);
  const patch = (item: SkillGroupItem, body: CollectionPatch<'skills'>) => {
    setPendingId(item.id);
    update.mutate({ id: item.id, patch: body }, { onSettled: () => setPendingId(null) });
  };

  return (
    <div>
      <Toolbar>
        <SegmentedControl
          label="Show skill groups"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
        />
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add skill group
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
          icon="skills"
          title={all.length === 0 ? 'No skill groups yet' : 'Nothing here'}
          description={
            all.length === 0
              ? 'Each skill group in your profile arrives here as a draft. You can also add one.'
              : 'No skill group matches this filter.'
          }
        />
      ) : (
        <ReorderableList
          items={shown}
          label="Skill groups"
          nameOf={(s) => s.cat}
          disabled={filter !== 'all' || reorder.isPending}
          onReorder={(ids) => reorder.mutate(ids)}
        >
          {(group) => (
            <div className="pf-item">
              <div className="pf-item-text">
                <div className="row items-center g2 wrap">
                  <span className="t-h4">{group.cat}</span>
                  <PublishBadge published={group.published} />
                  <SourceBadges
                    source={group.source}
                    followsSource={group.followsSource}
                    onRelink={() => patch(group, { followsSource: true })}
                    relinking={pendingId === group.id && update.isPending}
                  />
                </div>
                <Chips items={group.items} max={20} empty="No skills" />
              </div>
              <div className="pf-item-actions">
                <PublishSwitch
                  name={group.cat}
                  published={group.published}
                  pending={pendingId === group.id && update.isPending}
                  onChange={(published) => patch(group, { published })}
                />
                <Button
                  size="sm"
                  icon="pencil"
                  aria-label={`Edit ${group.cat}`}
                  onClick={() => setEditing(group)}
                >
                  Edit
                </Button>
              </div>
            </div>
          )}
        </ReorderableList>
      )}
      {editing ? (
        <SkillEditor
          key={editing === 'new' ? 'new' : editing.id}
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function SkillEditor({ group, onClose }: { group: SkillGroupItem | null; onClose: () => void }) {
  const create = useCreateItem('skills');
  const update = useUpdateItem('skills');
  const remove = useDeleteItem('skills');
  const [cat, setCat] = useState(group?.cat ?? '');
  const [items, setItems] = useState<string[]>(group?.items ?? []);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    if (cat.trim().length < 2) {
      setProblem('Name the category (at least 2 characters).');
      return;
    }
    setProblem(null);
    const body: SkillGroupInput = { cat: cat.trim(), items };
    if (!group) {
      create.mutate(body, { onSuccess: onClose });
      return;
    }
    const changed: Partial<SkillGroupInput> = {};
    if (body.cat !== group.cat) changed.cat = body.cat;
    if (JSON.stringify(body.items) !== JSON.stringify(group.items)) changed.items = body.items;
    if (Object.keys(changed).length === 0) onClose();
    else update.mutate({ id: group.id, patch: changed }, { onSuccess: onClose });
  };

  return (
    <EditorDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={group ? 'Edit skill group' : 'Add skill group'}
      onSubmit={save}
      saving={create.isPending || update.isPending}
      error={create.error ?? update.error}
      itemName={group?.cat}
      onDelete={group ? () => remove.mutate(group.id, { onSuccess: onClose }) : undefined}
      deleting={remove.isPending}
      deleteError={remove.error}
    >
      <Field label="Category" required error={problem ?? undefined}>
        <Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Frontend" />
      </Field>
      <Field label="Skills" hint="Press Enter or type a comma after each.">
        <TagInput value={items} onChange={setItems} aria-label="Skills" />
      </Field>
    </EditorDialog>
  );
}
