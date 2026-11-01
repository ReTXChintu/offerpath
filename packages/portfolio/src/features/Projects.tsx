import { describeError } from '@offerpath/learn';
import {
  Alert,
  Button,
  Chips,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Spinner,
  TagInput,
  Textarea,
} from '@offerpath/ui';
import { useEffect, useRef, useState } from 'react';

import {
  ColourField,
  ErrorAlert,
  GradientPreview,
  PublishBadge,
  PublishSwitch,
  ReorderableList,
  SourceBadges,
  Toolbar,
} from '../components/common';
import { EditorDialog } from '../components/EditorDialog';
import { usePortfolioHost } from '../context';
import { imageProblem, isHexColour, normaliseHex, readFileAsBase64 } from '../lib/format';
import {
  useCollection,
  useCreateItem,
  useDeleteItem,
  usePortfolio,
  useReorder,
  useUpdateItem,
  useUploadImage,
} from '../queries';
import type { CollectionPatch, ProjectInput, ProjectItem } from '../types';

export type PublishFilter = 'all' | 'drafts' | 'published';

export const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'published', label: 'Published' },
] as const;

export function applyFilter<T extends { published: boolean }>(items: T[], filter: PublishFilter) {
  if (filter === 'drafts') return items.filter((item) => !item.published);
  if (filter === 'published') return items.filter((item) => item.published);
  return items;
}

/** Why a project can't be published yet. */
export const NEEDS_IMAGE = 'Add an image to publish';

/** Projects: the site's cards, in order, drafts included. */
export function ProjectsSection() {
  const projects = useCollection('projects');
  const portfolio = usePortfolio();
  const update = useUpdateItem('projects');
  const reorder = useReorder('projects');
  const [filter, setFilter] = useState<PublishFilter>('all');
  const [editing, setEditing] = useState<ProjectItem | 'new' | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (projects.isLoading) return <Spinner label="Loading projects" />;
  if (projects.error)
    return <ErrorAlert error={projects.error} fallback="Projects did not load." />;
  const all = projects.data ?? [];
  const shown = applyFilter(all, filter);

  const patch = (item: ProjectItem, body: CollectionPatch<'projects'>) => {
    setPendingId(item.id);
    update.mutate({ id: item.id, patch: body }, { onSettled: () => setPendingId(null) });
  };

  return (
    <div>
      <Toolbar>
        <SegmentedControl
          label="Show projects"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
        />
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add project
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
      {filter !== 'all' && shown.length > 1 ? (
        <div className="t-caption mb2">Show All to change the order.</div>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="layout"
          title={all.length === 0 ? 'No projects yet' : 'Nothing here'}
          description={
            all.length === 0
              ? 'Projects from your profile arrive here as drafts. You can also add one yourself.'
              : 'No project matches this filter.'
          }
        />
      ) : (
        <ReorderableList
          items={shown}
          label="Projects"
          nameOf={(p) => p.title}
          disabled={filter !== 'all' || reorder.isPending}
          onReorder={(ids) => reorder.mutate(ids)}
        >
          {(project) => (
            <div className="pf-item">
              <div className="pf-thumb" aria-hidden>
                {project.imageUrl ? (
                  <img src={project.imageUrl} alt="" />
                ) : (
                  <span
                    className="pf-thumb-gradient"
                    style={{
                      background: `linear-gradient(135deg, ${project.gradientFrom}, ${project.gradientTo})`,
                    }}
                  />
                )}
              </div>
              <div className="pf-item-text">
                <div className="row items-center g2 wrap">
                  <span className="t-h4">{project.title}</span>
                  <PublishBadge published={project.published} />
                  <SourceBadges
                    source={project.source}
                    followsSource={project.followsSource}
                    onRelink={() => patch(project, { followsSource: true })}
                    relinking={pendingId === project.id && update.isPending}
                  />
                </div>
                {project.domain ? <div className="t-caption">{project.domain}</div> : null}
                <div className="t-small pf-clamp">{project.desc}</div>
                <Chips items={project.tags} max={8} empty={null} />
              </div>
              <div className="pf-item-actions">
                <PublishSwitch
                  name={project.title}
                  published={project.published}
                  disabledReason={!project.imageUrl && !project.published ? NEEDS_IMAGE : null}
                  pending={pendingId === project.id && update.isPending}
                  onChange={(published) => patch(project, { published })}
                />
                <Button
                  size="sm"
                  icon="pencil"
                  aria-label={`Edit ${project.title}`}
                  onClick={() => setEditing(project)}
                >
                  Edit
                </Button>
              </div>
            </div>
          )}
        </ReorderableList>
      )}

      {editing ? (
        <ProjectEditor
          key={editing === 'new' ? 'new' : editing.id}
          project={editing === 'new' ? null : editing}
          cloudinaryConfigured={portfolio.data?.cloudinary.configured ?? false}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

const NEW_PROJECT: ProjectInput = {
  title: '',
  desc: '',
  tags: [],
  accent: '#6366f1',
  gradientFrom: '#1e1b4b',
  gradientTo: '#4338ca',
  imageUrl: null,
  liveUrl: '',
  githubUrl: '',
  domain: '',
  localPath: null,
};

function draftOf(project: ProjectItem | null): ProjectInput {
  if (!project) return NEW_PROJECT;
  return {
    title: project.title,
    desc: project.desc,
    tags: project.tags,
    accent: project.accent,
    gradientFrom: project.gradientFrom,
    gradientTo: project.gradientTo,
    imageUrl: project.imageUrl,
    liveUrl: project.liveUrl,
    githubUrl: project.githubUrl,
    domain: project.domain,
    localPath: project.localPath,
  };
}

type ProjectErrors = Partial<Record<keyof ProjectInput, string>>;

export function validateProject(draft: ProjectInput): ProjectErrors {
  const errors: ProjectErrors = {};
  if (draft.title.trim().length < 2) errors.title = 'Use at least 2 characters.';
  if (draft.desc.trim().length < 10) errors.desc = 'Use at least 10 characters.';
  for (const key of ['accent', 'gradientFrom', 'gradientTo'] as const) {
    if (!isHexColour(draft[key])) errors[key] = 'Use a colour like #1a2b3c.';
  }
  return errors;
}

/** The fields to send: everything for a new project, only what changed for a saved one. */
export function projectBody(
  draft: ProjectInput,
  original: ProjectItem | null,
): ProjectInput | Partial<ProjectInput> {
  const clean: ProjectInput = {
    ...draft,
    title: draft.title.trim(),
    desc: draft.desc.trim(),
    accent: normaliseHex(draft.accent) ?? draft.accent,
    gradientFrom: normaliseHex(draft.gradientFrom) ?? draft.gradientFrom,
    gradientTo: normaliseHex(draft.gradientTo) ?? draft.gradientTo,
    imageUrl: draft.imageUrl?.trim() ? draft.imageUrl.trim() : null,
    liveUrl: draft.liveUrl.trim(),
    githubUrl: draft.githubUrl.trim(),
    domain: draft.domain.trim(),
    localPath: draft.localPath?.trim() ? draft.localPath.trim() : null,
  };
  if (!original) return clean;
  const before = draftOf(original);
  const changed: Partial<ProjectInput> = {};
  for (const key of Object.keys(clean) as (keyof ProjectInput)[]) {
    if (JSON.stringify(clean[key]) !== JSON.stringify(before[key])) {
      (changed as Record<string, unknown>)[key] = clean[key];
    }
  }
  return changed;
}

/** Add or edit one project. */
export function ProjectEditor({
  project,
  cloudinaryConfigured,
  onClose,
}: {
  project: ProjectItem | null;
  cloudinaryConfigured: boolean;
  onClose: () => void;
}) {
  const host = usePortfolioHost();
  const create = useCreateItem('projects');
  const update = useUpdateItem('projects');
  const remove = useDeleteItem('projects');
  const [draft, setDraft] = useState<ProjectInput>(() => draftOf(project));
  const [errors, setErrors] = useState<ProjectErrors>({});
  const set = (patch: Partial<ProjectInput>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const found = validateProject(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = projectBody(draft, project);
    if (!project) {
      create.mutate(body as ProjectInput, { onSuccess: onClose });
    } else if (Object.keys(body).length === 0) {
      onClose();
    } else {
      update.mutate({ id: project.id, patch: body }, { onSuccess: onClose });
    }
  };

  const linked = !!project?.source && project.followsSource;

  return (
    <EditorDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={project ? 'Edit project' : 'Add project'}
      size="lg"
      onSubmit={save}
      saving={create.isPending || update.isPending}
      error={create.error ?? update.error}
      itemName={project?.title}
      onDelete={project ? () => remove.mutate(project.id, { onSuccess: onClose }) : undefined}
      deleting={remove.isPending}
      deleteError={remove.error}
    >
      {linked ? (
        <Alert status="info">
          This project follows your profile. Editing its title, description or tags stops that; its
          image, colours, domain and order are always yours.
        </Alert>
      ) : null}
      <div className="grid grid-halves g4">
        <div className="col g4">
          <Field label="Title" required error={errors.title}>
            <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Domain" hint="A short category shown on the card, e.g. Fintech.">
            <Input value={draft.domain} onChange={(e) => set({ domain: e.target.value })} />
          </Field>
          <Field label="Description" required error={errors.desc}>
            <Textarea rows={4} value={draft.desc} onChange={(e) => set({ desc: e.target.value })} />
          </Field>
          <Field label="Tags" hint="Press Enter or type a comma after each.">
            <TagInput
              value={draft.tags}
              onChange={(tags) => set({ tags })}
              aria-label="Tags"
              placeholder="React, Node.js…"
            />
          </Field>
          <div className="grid grid-halves g4">
            <Field label="Live URL">
              <Input
                type="url"
                value={draft.liveUrl}
                onChange={(e) => set({ liveUrl: e.target.value })}
                placeholder="https://…"
              />
            </Field>
            <Field label="GitHub URL">
              <Input
                type="url"
                value={draft.githubUrl}
                onChange={(e) => set({ githubUrl: e.target.value })}
                placeholder="https://github.com/…"
              />
            </Field>
          </div>
        </div>
        <div className="col g4">
          <GradientPreview
            title={draft.title}
            subtitle={draft.domain}
            accent={draft.accent}
            gradientFrom={draft.gradientFrom}
            gradientTo={draft.gradientTo}
            imageUrl={draft.imageUrl}
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
          <ImageField
            value={draft.imageUrl}
            onChange={(imageUrl) => set({ imageUrl })}
            cloudinaryConfigured={cloudinaryConfigured}
          />
        </div>
      </div>

      {/*
       * ---- On this laptop: the desktop-only slot ----
       * The project's folder (`localPath`) and the host's project tools.
       * The laptop app passes `pickProjectFolder` and `renderProjectTools`
       * through <PortfolioProvider>; "Generate mockup" goes in that slot.
       */}
      <section className="pf-laptop" aria-label="On this laptop">
        <div className="t-eyebrow mb2">On this laptop</div>
        <ProjectFolderField value={draft.localPath} onChange={(localPath) => set({ localPath })} />
        {host.renderProjectTools ? (
          <div className="mt3" data-testid="project-tools-slot">
            {host.renderProjectTools({ project, draft, update: set })}
          </div>
        ) : null}
      </section>
    </EditorDialog>
  );
}

/** The project's folder: a native picker on the laptop, plain text elsewhere. */
function ProjectFolderField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { pickProjectFolder } = usePortfolioHost();
  const [picking, setPicking] = useState(false);
  const hint = 'The laptop app reads this folder to generate the project’s mockup image.';
  if (!pickProjectFolder) {
    return (
      <Field label="Project folder" hint={hint}>
        <Input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="C:\\code\\my-project"
          spellCheck={false}
          className="mono"
        />
      </Field>
    );
  }
  return (
    <Field label="Project folder" hint={hint}>
      <div className="row items-center g2">
        <Input value={value ?? ''} readOnly placeholder="Not chosen" className="mono flex-1" />
        <Button
          size="sm"
          icon="folder"
          loading={picking}
          onClick={() => {
            setPicking(true);
            void pickProjectFolder(value)
              .then((chosen) => {
                if (chosen) onChange(chosen);
              })
              .finally(() => setPicking(false));
          }}
        >
          Change…
        </Button>
        {value ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** The project's image: upload to the user's Cloudinary, or paste a URL. */
function ImageField({
  value,
  onChange,
  cloudinaryConfigured,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  cloudinaryConfigured: boolean;
}) {
  const upload = useUploadImage();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (upload.error) setProblem(describeError(upload.error, 'The image did not upload.'));
  }, [upload.error]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const bad = imageProblem(file);
    if (bad) {
      setProblem(bad);
      return;
    }
    setProblem(null);
    setReading(true);
    try {
      const contentBase64 = await readFileAsBase64(file);
      upload.mutate(
        { fileName: file.name, contentBase64 },
        { onSuccess: (reply) => onChange(reply.url) },
      );
    } catch {
      setProblem('The file could not be read.');
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Field
      label="Image"
      hint={
        cloudinaryConfigured
          ? 'PNG, JPG, WebP or GIF, up to 8 MB. A project needs an image to be published.'
          : 'Connect Cloudinary in Overview to upload; or paste an image URL. A project needs an image to be published.'
      }
      error={problem ?? undefined}
    >
      <div className="col g2">
        {value ? (
          <img src={value} alt="Project image preview" className="pf-image-preview" />
        ) : null}
        <Input
          aria-label="Image URL"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://res.cloudinary.com/…"
          spellCheck={false}
        />
        <div className="row g2 wrap">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            aria-label="Image file"
            tabIndex={-1}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button
            size="sm"
            icon="upload"
            loading={reading || upload.isPending}
            disabled={!cloudinaryConfigured}
            onClick={() => input.current?.click()}
          >
            Upload image
          </Button>
          {value ? (
            <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange(null)}>
              Remove image
            </Button>
          ) : null}
        </div>
      </div>
    </Field>
  );
}
