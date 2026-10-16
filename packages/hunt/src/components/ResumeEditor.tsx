import { Button, IconButton, Input, LinesInput, TagInput, Textarea } from '@offerpath/ui';
import { useState } from 'react';

import type { ResumeDocument, ResumeExperience, ResumeProject } from '../types';

/** Structured editor for a generated resume. Saving re-renders the DOCX/PDF. */
export function ResumeEditor({
  value,
  onSave,
  onCancel,
  saving,
}: {
  value: ResumeDocument;
  onSave: (doc: ResumeDocument) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [doc, setDoc] = useState<ResumeDocument>(() => structuredClone(value));
  const set = <K extends keyof ResumeDocument>(k: K, v: ResumeDocument[K]) =>
    setDoc((d) => ({ ...d, [k]: v }));

  return (
    <div className="col g5">
      <section>
        <h4 className="t-h4 mb2">Headline &amp; summary</h4>
        <Input
          size="sm"
          className="mb2"
          aria-label="Headline"
          value={doc.headline}
          onChange={(e) => set('headline', e.target.value)}
          placeholder="Headline"
        />
        <Textarea
          rows={4}
          aria-label="Summary"
          value={doc.summary}
          onChange={(e) => set('summary', e.target.value)}
          placeholder="Summary"
        />
      </section>
      <section>
        <div className="row justify-between items-center mb2">
          <h4 className="t-h4">Skills</h4>
          <Button
            size="xs"
            variant="ghost"
            icon="plus"
            onClick={() => set('skills', [...doc.skills, { name: 'New section', items: [] }])}
          >
            Section
          </Button>
        </div>
        <div className="col g2">
          {doc.skills.map((s, i) => (
            <div key={i} className="row items-start g2">
              <Input
                size="sm"
                style={{ width: 160 }}
                aria-label="Skill section name"
                value={s.name}
                onChange={(e) =>
                  set(
                    'skills',
                    doc.skills.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <div className="flex-1">
                <TagInput
                  aria-label={`${s.name} skills`}
                  value={s.items}
                  onChange={(items) =>
                    set(
                      'skills',
                      doc.skills.map((x, j) => (j === i ? { ...x, items } : x)),
                    )
                  }
                />
              </div>
              <IconButton
                icon="trash"
                size="sm"
                variant="danger"
                label={`Remove the ${s.name} section`}
                onClick={() =>
                  set(
                    'skills',
                    doc.skills.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
        </div>
      </section>
      <section>
        <h4 className="t-h4 mb2">Experience</h4>
        <div className="col g3">
          {doc.experience.map((e, i) => (
            <ExperienceRow
              key={i}
              value={e}
              onChange={(v) =>
                set(
                  'experience',
                  doc.experience.map((x, j) => (j === i ? v : x)),
                )
              }
              onRemove={() =>
                set(
                  'experience',
                  doc.experience.filter((_, j) => j !== i),
                )
              }
            />
          ))}
        </div>
      </section>
      <section>
        <h4 className="t-h4 mb2">Projects</h4>
        <div className="col g3">
          {doc.projects.map((p, i) => (
            <ProjectRow
              key={i}
              value={p}
              onChange={(v) =>
                set(
                  'projects',
                  doc.projects.map((x, j) => (j === i ? v : x)),
                )
              }
              onRemove={() =>
                set(
                  'projects',
                  doc.projects.filter((_, j) => j !== i),
                )
              }
            />
          ))}
        </div>
      </section>
      <div className="grid grid-halves g3">
        <section>
          <h4 className="t-h4 mb2">Certifications</h4>
          <LinesInput
            aria-label="Certifications"
            value={doc.certifications}
            onChange={(v) => set('certifications', v)}
            rows={3}
          />
        </section>
        <section>
          <h4 className="t-h4 mb2">Achievements</h4>
          <LinesInput
            aria-label="Achievements"
            value={doc.achievements}
            onChange={(v) => set('achievements', v)}
            rows={3}
          />
        </section>
      </div>
      <div className="row justify-end g2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" loading={saving} onClick={() => onSave(doc)}>
          Save &amp; re-render documents
        </Button>
      </div>
    </div>
  );
}

function ExperienceRow({
  value,
  onChange,
  onRemove,
}: {
  value: ResumeExperience;
  onChange: (v: ResumeExperience) => void;
  onRemove: () => void;
}) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="grid grid-4 g2 mb2">
        <Input
          size="sm"
          aria-label="Role"
          value={value.role}
          placeholder="Role"
          onChange={(e) => onChange({ ...value, role: e.target.value })}
        />
        <Input
          size="sm"
          aria-label="Company"
          value={value.company}
          placeholder="Company"
          onChange={(e) => onChange({ ...value, company: e.target.value })}
        />
        <Input
          size="sm"
          aria-label="Start"
          value={value.startDate}
          placeholder="Start"
          onChange={(e) => onChange({ ...value, startDate: e.target.value })}
        />
        <Input
          size="sm"
          aria-label="End"
          value={value.endDate}
          placeholder="End (blank = present)"
          onChange={(e) => onChange({ ...value, endDate: e.target.value })}
        />
      </div>
      <LinesInput
        aria-label="Bullets"
        value={value.bullets}
        onChange={(bullets) => onChange({ ...value, bullets })}
        rows={4}
        placeholder="One bullet per line"
      />
      <div className="row justify-end mt1">
        <Button size="xs" variant="danger" icon="trash" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function ProjectRow({
  value,
  onChange,
  onRemove,
}: {
  value: ResumeProject;
  onChange: (v: ResumeProject) => void;
  onRemove: () => void;
}) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row g2 mb2">
        <Input
          size="sm"
          style={{ maxWidth: 240 }}
          aria-label="Project"
          value={value.name}
          placeholder="Project"
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <div className="flex-1">
          <TagInput
            aria-label="Technologies"
            value={value.technologies}
            onChange={(technologies) => onChange({ ...value, technologies })}
            placeholder="Technologies"
          />
        </div>
      </div>
      <Textarea
        rows={2}
        aria-label="Description"
        value={value.description}
        placeholder="Description"
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      <div className="row justify-end mt1">
        <Button size="xs" variant="danger" icon="trash" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
