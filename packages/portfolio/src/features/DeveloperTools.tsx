import {
  Badge,
  Button,
  Card,
  Chips,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Spinner,
  Switch,
  TagInput,
  Textarea,
} from '@offerpath/ui';
import { useState } from 'react';

import {
  ColourField,
  ErrorAlert,
  GradientPreview,
  PublishBadge,
  PublishSwitch,
  Toolbar,
} from '../components/common';
import { EditorDialog } from '../components/EditorDialog';
import { isHexColour, normaliseHex } from '../lib/format';
import { useCollection, useCreateItem, useDeleteItem, useUpdateItem } from '../queries';
import type { CollectionPatch, DeveloperToolInput, DeveloperToolItem } from '../types';

import { FILTER_OPTIONS, applyFilter, type PublishFilter } from './Projects';

/** Developer tools: packages and CLIs, ordered by their sort order. */
export function DeveloperToolsSection() {
  const tools = useCollection('developer-tools');
  const update = useUpdateItem('developer-tools');
  const [filter, setFilter] = useState<PublishFilter>('all');
  const [editing, setEditing] = useState<DeveloperToolItem | 'new' | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (tools.isLoading) return <Spinner label="Loading developer tools" />;
  if (tools.error) {
    return <ErrorAlert error={tools.error} fallback="Developer tools did not load." />;
  }
  const all = tools.data ?? [];
  const shown = applyFilter(all, filter);
  const patch = (item: DeveloperToolItem, body: CollectionPatch<'developer-tools'>) => {
    setPendingId(item.id);
    update.mutate({ id: item.id, patch: body }, { onSettled: () => setPendingId(null) });
  };

  return (
    <div>
      <Toolbar>
        <SegmentedControl
          label="Show developer tools"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
        />
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add developer tool
        </Button>
      </Toolbar>
      {update.error ? (
        <div className="mb4">
          <ErrorAlert error={update.error} />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState
          icon="terminal"
          title={all.length === 0 ? 'No developer tools yet' : 'Nothing here'}
          description={
            all.length === 0
              ? 'Libraries, CLIs and packages you built, with their install command and links.'
              : 'No developer tool matches this filter.'
          }
        />
      ) : (
        <ul className="pf-list" aria-label="Developer tools">
          {shown.map((tool) => (
            <li key={tool.id}>
              <Card className="pf-item">
                <span
                  className="pf-thumb pf-thumb-gradient"
                  aria-hidden
                  style={{
                    background: `linear-gradient(135deg, ${tool.gradientFrom}, ${tool.gradientTo})`,
                  }}
                />
                <div className="pf-item-text">
                  <div className="row items-center g2 wrap">
                    <span className="t-h4">{tool.title}</span>
                    {tool.version ? <span className="t-caption mono">v{tool.version}</span> : null}
                    <PublishBadge published={tool.published} />
                    {tool.featured ? (
                      <Badge variant="highlight" icon="star" size="sm">
                        Featured
                      </Badge>
                    ) : null}
                    <span className="t-caption" title="Sort order">
                      #{tool.sortOrder}
                    </span>
                  </div>
                  <div className="t-small pf-clamp">{tool.shortDescription}</div>
                  {tool.installCommand ? (
                    <code className="t-code">{tool.installCommand}</code>
                  ) : null}
                  <Chips items={tool.techStacks} max={8} empty={null} />
                </div>
                <div className="pf-item-actions">
                  <Switch
                    checked={tool.featured}
                    onCheckedChange={(featured) => patch(tool, { featured })}
                    disabled={pendingId === tool.id && update.isPending}
                    aria-label={`Feature ${tool.title}`}
                  >
                    Featured
                  </Switch>
                  <PublishSwitch
                    name={tool.title}
                    published={tool.published}
                    pending={pendingId === tool.id && update.isPending}
                    onChange={(published) => patch(tool, { published })}
                  />
                  <Button
                    size="sm"
                    icon="pencil"
                    aria-label={`Edit ${tool.title}`}
                    onClick={() => setEditing(tool)}
                  >
                    Edit
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ToolEditor
          key={editing === 'new' ? 'new' : editing.id}
          tool={editing === 'new' ? null : editing}
          nextSortOrder={all.reduce((max, t) => Math.max(max, t.sortOrder + 1), 0)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function draftOf(tool: DeveloperToolItem | null, nextSortOrder: number): DeveloperToolInput {
  return {
    title: tool?.title ?? '',
    shortDescription: tool?.shortDescription ?? '',
    fullDescription: tool?.fullDescription ?? '',
    domain: tool?.domain ?? '',
    techStacks: tool?.techStacks ?? [],
    accent: tool?.accent ?? '#10b981',
    gradientFrom: tool?.gradientFrom ?? '#064e3b',
    gradientTo: tool?.gradientTo ?? '#047857',
    githubUrl: tool?.githubUrl ?? '',
    npmUrl: tool?.npmUrl ?? '',
    docsUrl: tool?.docsUrl ?? '',
    demoUrl: tool?.demoUrl ?? '',
    installCommand: tool?.installCommand ?? '',
    packageName: tool?.packageName ?? '',
    version: tool?.version ?? '',
    featured: tool?.featured ?? false,
    published: tool?.published ?? false,
    sortOrder: tool?.sortOrder ?? nextSortOrder,
  };
}

type ToolErrors = Partial<Record<keyof DeveloperToolInput, string>>;

export function validateTool(draft: DeveloperToolInput): ToolErrors {
  const errors: ToolErrors = {};
  if (draft.title.trim().length < 2) errors.title = 'Use at least 2 characters.';
  if (draft.shortDescription.trim().length < 10) {
    errors.shortDescription = 'Use at least 10 characters.';
  }
  for (const key of ['accent', 'gradientFrom', 'gradientTo'] as const) {
    if (!isHexColour(draft[key])) errors[key] = 'Use a colour like #1a2b3c.';
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0) {
    errors.sortOrder = 'Use a whole number, 0 or more.';
  }
  return errors;
}

const TEXT_KEYS = [
  'title',
  'shortDescription',
  'fullDescription',
  'domain',
  'githubUrl',
  'npmUrl',
  'docsUrl',
  'demoUrl',
  'installCommand',
  'packageName',
  'version',
] as const;

function ToolEditor({
  tool,
  nextSortOrder,
  onClose,
}: {
  tool: DeveloperToolItem | null;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const create = useCreateItem('developer-tools');
  const update = useUpdateItem('developer-tools');
  const remove = useDeleteItem('developer-tools');
  const [draft, setDraft] = useState<DeveloperToolInput>(() => draftOf(tool, nextSortOrder));
  const [sortText, setSortText] = useState(String(draft.sortOrder));
  const [errors, setErrors] = useState<ToolErrors>({});
  const set = (patch: Partial<DeveloperToolInput>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const sortOrder = sortText.trim() === '' ? NaN : Number(sortText);
    const next: DeveloperToolInput = { ...draft, sortOrder };
    for (const key of TEXT_KEYS) next[key] = next[key].trim();
    for (const key of ['accent', 'gradientFrom', 'gradientTo'] as const) {
      next[key] = normaliseHex(next[key]) ?? next[key];
    }
    const found = validateTool(next);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!tool) {
      create.mutate(next, { onSuccess: onClose });
      return;
    }
    const before = draftOf(tool, nextSortOrder);
    const changed: Partial<DeveloperToolInput> = {};
    for (const key of Object.keys(next) as (keyof DeveloperToolInput)[]) {
      if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) {
        (changed as Record<string, unknown>)[key] = next[key];
      }
    }
    if (Object.keys(changed).length === 0) onClose();
    else update.mutate({ id: tool.id, patch: changed }, { onSuccess: onClose });
  };

  const text = (key: (typeof TEXT_KEYS)[number], label: string, placeholder?: string) => (
    <Field label={label} error={errors[key]}>
      <Input
        value={draft[key]}
        onChange={(e) => set({ [key]: e.target.value })}
        placeholder={placeholder}
      />
    </Field>
  );

  return (
    <EditorDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={tool ? 'Edit developer tool' : 'Add developer tool'}
      description={tool ? `Its page on your site: /${tool.slug}` : undefined}
      size="lg"
      onSubmit={save}
      saving={create.isPending || update.isPending}
      error={create.error ?? update.error}
      itemName={tool?.title}
      onDelete={tool ? () => remove.mutate(tool.id, { onSuccess: onClose }) : undefined}
      deleting={remove.isPending}
      deleteError={remove.error}
    >
      <div className="grid grid-halves g4">
        <div className="col g4">
          <Field label="Title" required error={errors.title}>
            <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Short description" required error={errors.shortDescription}>
            <Input
              value={draft.shortDescription}
              onChange={(e) => set({ shortDescription: e.target.value })}
            />
          </Field>
          <Field label="Full description">
            <Textarea
              rows={5}
              value={draft.fullDescription}
              onChange={(e) => set({ fullDescription: e.target.value })}
            />
          </Field>
          {text('domain', 'Domain', 'Developer experience')}
          <Field label="Tech stack" hint="Press Enter or type a comma after each.">
            <TagInput
              value={draft.techStacks}
              onChange={(techStacks) => set({ techStacks })}
              aria-label="Tech stack"
            />
          </Field>
          <div className="grid grid-halves g4">
            {text('packageName', 'Package name', '@me/tool')}
            {text('version', 'Version', '1.0.0')}
          </div>
          {text('installCommand', 'Install command', 'npm i @me/tool')}
        </div>
        <div className="col g4">
          <GradientPreview
            title={draft.title}
            subtitle={draft.shortDescription}
            accent={draft.accent}
            gradientFrom={draft.gradientFrom}
            gradientTo={draft.gradientTo}
          />
          <div className="grid grid-3 g3 pf-colours">
            <ColourField
              label="Accent"
              value={draft.accent}
              onChange={(accent) => set({ accent })}
              error={errors.accent}
            />
            <ColourField
              label="Gradient from"
              value={draft.gradientFrom}
              onChange={(gradientFrom) => set({ gradientFrom })}
              error={errors.gradientFrom}
            />
            <ColourField
              label="Gradient to"
              value={draft.gradientTo}
              onChange={(gradientTo) => set({ gradientTo })}
              error={errors.gradientTo}
            />
          </div>
          <div className="grid grid-halves g4">
            {text('githubUrl', 'GitHub URL', 'https://github.com/…')}
            {text('npmUrl', 'npm URL', 'https://www.npmjs.com/package/…')}
            {text('docsUrl', 'Docs URL', 'https://…')}
            {text('demoUrl', 'Demo URL', 'https://…')}
          </div>
          <Field label="Sort order" hint="Lower comes first." error={errors.sortOrder}>
            <Input
              type="number"
              min={0}
              step={1}
              value={sortText}
              onChange={(e) => setSortText(e.target.value)}
            />
          </Field>
          <div className="row g5 wrap">
            <Switch checked={draft.featured} onCheckedChange={(featured) => set({ featured })}>
              Featured
            </Switch>
            <Switch checked={draft.published} onCheckedChange={(published) => set({ published })}>
              Published
            </Switch>
          </div>
        </div>
      </div>
    </EditorDialog>
  );
}
