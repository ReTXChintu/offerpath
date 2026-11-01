import { Button, Field, Input, Panel, Textarea } from '@offerpath/ui';
import { useState, type FormEvent } from 'react';

import { ErrorAlert } from '../components/common';
import { linesToList, paragraphsToText, textToParagraphs } from '../lib/format';
import { useUpdatePortfolio } from '../queries';
import type { SiteSettings, SiteSocials } from '../types';

interface SettingsForm {
  heroName: string;
  heroEyebrow: string;
  roles: string;
  heroBio: string;
  resumeUrl: string;
  aboutHeadline: string;
  aboutParagraphs: string;
  socials: SiteSocials;
}

function formOf(settings: SiteSettings): SettingsForm {
  return {
    heroName: settings.heroName,
    heroEyebrow: settings.heroEyebrow,
    roles: settings.roles.join('\n'),
    heroBio: settings.heroBio,
    resumeUrl: settings.resumeUrl,
    aboutHeadline: settings.aboutHeadline,
    aboutParagraphs: paragraphsToText(settings.aboutParagraphs),
    socials: { ...settings.socials },
  };
}

/** The form's values as the API's settings. */
export function settingsFromForm(form: SettingsForm): SiteSettings {
  return {
    heroName: form.heroName.trim(),
    heroEyebrow: form.heroEyebrow.trim(),
    roles: linesToList(form.roles),
    heroBio: form.heroBio.trim(),
    resumeUrl: form.resumeUrl.trim(),
    aboutHeadline: form.aboutHeadline.trim(),
    aboutParagraphs: textToParagraphs(form.aboutParagraphs),
    socials: {
      github: form.socials.github.trim(),
      linkedin: form.socials.linkedin.trim(),
      twitter: form.socials.twitter.trim(),
      email: form.socials.email.trim(),
    },
  };
}

/** The site's own words: the hero, the about section and the social links. */
export function SiteSettingsSection({ settings }: { settings: SiteSettings }) {
  const update = useUpdatePortfolio();
  const [form, setForm] = useState<SettingsForm>(() => formOf(settings));
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<SettingsForm>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };
  const setSocial = (key: keyof SiteSocials, value: string) =>
    set({ socials: { ...form.socials, [key]: value } });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(
      { settings: settingsFromForm(form) },
      {
        onSuccess: (view) => {
          setForm(formOf(view.settings));
          setSaved(true);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="col g5" noValidate aria-label="Site settings">
      <div className="grid grid-halves g5">
        <Panel title="Hero">
          <div className="col g4">
            <div className="grid grid-halves g4">
              <Field label="Name">
                <Input value={form.heroName} onChange={(e) => set({ heroName: e.target.value })} />
              </Field>
              <Field label="Eyebrow" hint="The short line above your name.">
                <Input
                  value={form.heroEyebrow}
                  onChange={(e) => set({ heroEyebrow: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Roles" hint="One per line; the site cycles through them.">
              <Textarea
                rows={4}
                value={form.roles}
                onChange={(e) => set({ roles: e.target.value })}
              />
            </Field>
            <Field label="Bio">
              <Textarea
                rows={4}
                value={form.heroBio}
                onChange={(e) => set({ heroBio: e.target.value })}
              />
            </Field>
            <Field label="Resume URL">
              <Input
                type="url"
                value={form.resumeUrl}
                onChange={(e) => set({ resumeUrl: e.target.value })}
                placeholder="https://…"
              />
            </Field>
          </div>
        </Panel>
        <div className="col g5">
          <Panel title="About">
            <div className="col g4">
              <Field label="Headline">
                <Input
                  value={form.aboutHeadline}
                  onChange={(e) => set({ aboutHeadline: e.target.value })}
                />
              </Field>
              <Field label="Paragraphs" hint="Leave a blank line between paragraphs.">
                <Textarea
                  rows={8}
                  value={form.aboutParagraphs}
                  onChange={(e) => set({ aboutParagraphs: e.target.value })}
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Social links">
            <div className="grid grid-halves g4">
              <Field label="GitHub">
                <Input
                  value={form.socials.github}
                  onChange={(e) => setSocial('github', e.target.value)}
                  placeholder="https://github.com/…"
                />
              </Field>
              <Field label="LinkedIn">
                <Input
                  value={form.socials.linkedin}
                  onChange={(e) => setSocial('linkedin', e.target.value)}
                  placeholder="https://www.linkedin.com/in/…"
                />
              </Field>
              <Field label="Twitter">
                <Input
                  value={form.socials.twitter}
                  onChange={(e) => setSocial('twitter', e.target.value)}
                  placeholder="https://x.com/…"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.socials.email}
                  onChange={(e) => setSocial('email', e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
            </div>
          </Panel>
        </div>
      </div>
      <ErrorAlert error={update.error} fallback="The settings were not saved." />
      <div className="row items-center g3">
        <Button type="submit" variant="primary" icon="save" loading={update.isPending}>
          Save settings
        </Button>
        {saved ? <span className="t-caption">Saved</span> : null}
      </div>
    </form>
  );
}
