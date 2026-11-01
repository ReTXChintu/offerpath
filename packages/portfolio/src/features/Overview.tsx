import { describeError } from '@offerpath/learn';
import { Alert, Button, Field, Input, Panel, Stat, toast } from '@offerpath/ui';
import { useState, type FormEvent } from 'react';

import { CopyButton, ErrorAlert } from '../components/common';
import { usePortfolioHost } from '../context';
import { handleProblem, netlifySnippet, publicSiteUrl } from '../lib/format';
import { useImportProfile, useUpdatePortfolio } from '../queries';
import type { PortfolioView } from '../types';

import { CloudinaryPanel } from './Cloudinary';

/**
 * Items on the site. `counts` has each collection's total and the drafts
 * across all of them, so what's published is the rest.
 */
export function publishedCount(counts: PortfolioView['counts']): number {
  const total = counts.projects + counts.skills + counts.experience + counts.developerTools;
  return Math.max(0, total - counts.drafts);
}

/** The portfolio at a glance: its address, what's on it, and how to connect a site. */
export function Overview({ view }: { view: PortfolioView }) {
  const { apiOrigin } = usePortfolioHost();
  const importProfile = useImportProfile();
  const siteUrl = publicSiteUrl(apiOrigin, view.publicUrl);
  const snippet = netlifySnippet(siteUrl);

  const runImport = () =>
    importProfile.mutate(undefined, {
      onSuccess: ({ created, updated }) =>
        toast.show({
          type: 'success',
          title: 'Imported from your profile',
          description:
            created || updated
              ? `${created} new draft${created === 1 ? '' : 's'}, ${updated} updated.`
              : 'Everything was already here.',
        }),
      onError: (error) =>
        toast.show({
          type: 'error',
          title: 'The import did not run',
          description: describeError(error),
        }),
    });

  return (
    <div className="col g5">
      <div className="grid grid-main-side g5">
        <Panel title="Your portfolio's API">
          <div className="t-small mb3">
            Your site reads everything it shows from this address. Only published items appear on
            it.
          </div>
          <div className="row items-center g2 mb4">
            <Input
              readOnly
              value={siteUrl}
              aria-label="Public API URL"
              className="mono flex-1"
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={siteUrl} label="Copy URL" />
            <a className="btn btn-ghost btn-sm" href={siteUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
          {!apiOrigin ? (
            <Alert status="info" className="mb4">
              Add your Offerpath server&apos;s address in front of this path.
            </Alert>
          ) : null}
          <HandleEditor handle={view.handle} />
        </Panel>

        <Panel
          title="On your site"
          action={
            <Button size="sm" icon="refresh" loading={importProfile.isPending} onClick={runImport}>
              Import from profile now
            </Button>
          }
        >
          <div className="grid grid-3 g4">
            <Stat label="Published" value={publishedCount(view.counts)} tone="success" />
            <Stat label="Drafts" value={view.counts.drafts} tone="warning" />
            <Stat
              label="Unread messages"
              value={view.counts.unreadMessages}
              tone={view.counts.unreadMessages ? 'primary' : 'default'}
            />
            <Stat label="Projects" value={view.counts.projects} />
            <Stat label="Skill groups" value={view.counts.skills} />
            <Stat label="Experience" value={view.counts.experience} />
            <Stat label="Developer tools" value={view.counts.developerTools} />
          </div>
          <div className="t-caption mt4">
            New projects, experience and skills from your profile arrive as drafts by themselves
            whenever your profile syncs.
          </div>
        </Panel>
      </div>

      <div className="grid grid-halves g5">
        <CloudinaryPanel status={view.cloudinary} />
        <Panel title="Connect your site" action={<CopyButton text={snippet} label="Copy" />}>
          <div className="t-small mb3">
            A site served over HTTPS can&apos;t call a plain-HTTP API, so let its host proxy the
            calls. On Netlify, add this to <span className="t-code">netlify.toml</span>; the site
            then reads <span className="t-code">/api/site</span> and posts its contact form to{' '}
            <span className="t-code">/api/contact</span> on its own address.
          </div>
          <pre className="code-block pf-snippet" aria-label="Netlify proxy snippet">
            {snippet}
          </pre>
        </Panel>
      </div>
    </div>
  );
}

/** The handle: the portfolio's name in its public address. */
function HandleEditor({ handle }: { handle: string }) {
  const update = useUpdatePortfolio();
  const [value, setValue] = useState(handle);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = value.trim() !== handle;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    const bad = handleProblem(next);
    setProblem(bad);
    if (bad || !changed) return;
    update.mutate(
      { handle: next },
      {
        onSuccess: () =>
          toast.show({
            type: 'success',
            title: 'Handle changed',
            description: 'Update the address in your site’s proxy too.',
          }),
      },
    );
  };

  return (
    <form onSubmit={submit} className="col g3" noValidate>
      <Field
        label="Handle"
        hint="3–40 lowercase letters, digits or dashes. Changing it changes the address."
        error={problem ?? undefined}
      >
        <div className="row items-center g2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase())}
            spellCheck={false}
            maxLength={40}
            className="flex-1"
          />
          <Button type="submit" loading={update.isPending} disabled={!changed}>
            Save handle
          </Button>
        </div>
      </Field>
      <ErrorAlert error={update.error} />
    </form>
  );
}
