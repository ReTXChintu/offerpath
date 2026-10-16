import {
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  LinesInput,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TagInput,
  Textarea,
} from '@offerpath/ui';
import { useEffect, useState } from 'react';

import { useHuntClient } from '../client';
import { AdditionalDetails } from '../components/AdditionalDetails';
import { ErrorBanner, InfoBanner, Loading } from '../components/common';
import { fileName, formatDateTime, profileIssues } from '../logic';
import {
  useDeleteExperience,
  useDeleteProject,
  useDraftProject,
  useExperiences,
  useImportMasterResume,
  useMasterResumeText,
  useParseMasterResume,
  useProfile,
  useProjects,
  useSaveExperience,
  useSaveProfile,
  useSaveProject,
} from '../queries';
import type {
  CandidateProfile,
  Certification,
  Education,
  EmploymentType,
  Experience,
  PersonalInfo,
  Project,
  RelocationPreference,
  RemotePreference,
} from '../types';

const EMPLOYMENT: EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'FREELANCE',
  'INTERNSHIP',
];

const PERSONAL_FIELDS: readonly (readonly [keyof PersonalInfo, string])[] = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['location', 'Location'],
  ['currentTitle', 'Current title'],
  ['linkedin', 'LinkedIn'],
  ['github', 'GitHub'],
  ['portfolio', 'Portfolio'],
];

const SKILL_GROUP_KEYS = [
  'frontend',
  'backend',
  'database',
  'devops',
  'cloud',
  'testing',
  'other',
] as const;

const numberOrNull = (v: string) => (v === '' ? null : Number(v));

export function CandidatePage() {
  const profileQ = useProfile();
  const save = useSaveProfile();
  const [draft, setDraft] = useState<CandidateProfile | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (profileQ.data && !dirty) setDraft(structuredClone(profileQ.data));
  }, [profileQ.data, dirty]);

  if (!draft)
    return profileQ.error ? (
      <ErrorBanner error={profileQ.error} onRetry={() => void profileQ.refetch()} />
    ) : (
      <Loading label="Loading your profile" />
    );
  const update = (fn: (p: CandidateProfile) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const issues = profileIssues(draft);

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title="Candidate"
        subtitle="Everything the agent is allowed to know about you. It will never claim anything that is not on this page."
        actions={
          <Button
            variant="primary"
            icon="save"
            onClick={() => save.mutate(draft, { onSuccess: () => setDirty(false) })}
            loading={save.isPending}
            disabled={!dirty}
          >
            Save profile
          </Button>
        }
      />
      <ErrorBanner error={save.error} />
      {issues.length ? (
        <InfoBanner status="warning" title="Before a job hunt can start">
          {issues.join(' · ')}
        </InfoBanner>
      ) : null}
      <Tabs defaultValue="personal">
        <TabsList label="Profile sections">
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="education">Education &amp; more</TabsTrigger>
          <TabsTrigger value="details">Additional details</TabsTrigger>
          <TabsTrigger value="resume">Master resume</TabsTrigger>
        </TabsList>

        <TabsContent value="personal">
          <Panel>
            <div className="grid grid-halves g4">
              {PERSONAL_FIELDS.map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    value={draft.personal[key]}
                    onChange={(e) =>
                      update((p) => {
                        p.personal[key] = e.target.value;
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Professional summary (optional)" className="mt4">
              <Textarea
                rows={3}
                value={draft.summary}
                onChange={(e) =>
                  update((p) => {
                    p.summary = e.target.value;
                  })
                }
              />
            </Field>
          </Panel>
        </TabsContent>

        <TabsContent value="preferences">
          <Panel>
            <div className="grid grid-halves g4">
              <Field
                label="Target roles"
                hint="Used to build search queries. Up to four are searched per source."
              >
                <TagInput
                  value={draft.preferences.targetRoles}
                  onChange={(v) =>
                    update((p) => {
                      p.preferences.targetRoles = v;
                    })
                  }
                  placeholder="e.g. Full Stack Developer"
                />
              </Field>
              <Field label="Preferred locations">
                <TagInput
                  value={draft.preferences.preferredLocations}
                  onChange={(v) =>
                    update((p) => {
                      p.preferences.preferredLocations = v;
                    })
                  }
                  placeholder="e.g. Mumbai, Remote"
                />
              </Field>
              <Field label="Remote preference">
                <Select
                  value={draft.preferences.remotePreference}
                  onChange={(e) =>
                    update((p) => {
                      p.preferences.remotePreference = e.target.value as RemotePreference;
                    })
                  }
                >
                  <option value="ANY">Any</option>
                  <option value="REMOTE">Remote only</option>
                  <option value="HYBRID">Hybrid</option>
                  <option value="ONSITE">On-site</option>
                </Select>
              </Field>
              <Field label="Relocation">
                <Select
                  value={draft.preferences.relocation}
                  onChange={(e) =>
                    update((p) => {
                      p.preferences.relocation = e.target.value as RelocationPreference;
                    })
                  }
                >
                  <option value="NOT_SPECIFIED">Not specified</option>
                  <option value="YES">Willing to relocate</option>
                  <option value="MAYBE">Maybe</option>
                  <option value="NO">No</option>
                </Select>
              </Field>
              <div className="field">
                <span className="field-label" id="employment-types">
                  Employment types
                </span>
                <div className="tag-list" role="group" aria-labelledby="employment-types">
                  {EMPLOYMENT.map((t) => {
                    const on = draft.preferences.employmentTypes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={on ? 'chip chip-sm selected' : 'chip chip-sm'}
                        aria-pressed={on}
                        onClick={() =>
                          update((p) => {
                            p.preferences.employmentTypes = on
                              ? p.preferences.employmentTypes.filter((x) => x !== t)
                              : [...p.preferences.employmentTypes, t];
                          })
                        }
                      >
                        {t.replace('_', ' ').toLowerCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="Notice period">
                <Input
                  value={draft.preferences.noticePeriod}
                  placeholder="e.g. 30 days"
                  onChange={(e) =>
                    update((p) => {
                      p.preferences.noticePeriod = e.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Minimum experience roles should require (years)">
                <Input
                  type="number"
                  value={draft.preferences.minimumExperienceYears ?? ''}
                  onChange={(e) =>
                    update((p) => {
                      p.preferences.minimumExperienceYears = numberOrNull(e.target.value);
                    })
                  }
                />
              </Field>
              <div className="field">
                <span className="field-label">Salary expectation</span>
                <div className="row g2">
                  <Input
                    type="number"
                    aria-label="Minimum salary"
                    placeholder="Min"
                    value={draft.preferences.salary.minimum ?? ''}
                    onChange={(e) =>
                      update((p) => {
                        p.preferences.salary.minimum = numberOrNull(e.target.value);
                      })
                    }
                  />
                  <Input
                    type="number"
                    aria-label="Maximum salary"
                    placeholder="Max"
                    value={draft.preferences.salary.maximum ?? ''}
                    onChange={(e) =>
                      update((p) => {
                        p.preferences.salary.maximum = numberOrNull(e.target.value);
                      })
                    }
                  />
                  <Input
                    style={{ width: 90 }}
                    aria-label="Currency"
                    value={draft.preferences.salary.currency}
                    onChange={(e) =>
                      update((p) => {
                        p.preferences.salary.currency = e.target.value;
                      })
                    }
                  />
                  <Select
                    aria-label="Salary period"
                    value={draft.preferences.salary.period}
                    onChange={(e) =>
                      update((p) => {
                        p.preferences.salary.period = e.target.value;
                      })
                    }
                  >
                    <option value="YEAR">per year</option>
                    <option value="MONTH">per month</option>
                  </Select>
                </div>
              </div>
            </div>
            <Field
              label="Notes for the agent (companies to avoid, industries, constraints)"
              className="mt4"
            >
              <Textarea
                rows={3}
                value={draft.preferences.notes}
                onChange={(e) =>
                  update((p) => {
                    p.preferences.notes = e.target.value;
                  })
                }
              />
            </Field>
          </Panel>
        </TabsContent>

        <TabsContent value="skills">
          <Panel>
            <div className="grid grid-halves g4">
              {SKILL_GROUP_KEYS.map((group) => (
                <Field
                  key={group}
                  label={<span style={{ textTransform: 'capitalize' }}>{group}</span>}
                >
                  <TagInput
                    value={draft.skills[group]}
                    onChange={(v) =>
                      update((p) => {
                        p.skills[group] = v;
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="experience">
          <ExperienceTab />
        </TabsContent>
        <TabsContent value="projects">
          <ProjectsTab />
        </TabsContent>

        <TabsContent value="education">
          <div className="col g4">
            <Panel
              title="Education"
              action={
                <Button
                  size="xs"
                  variant="ghost"
                  icon="plus"
                  onClick={() =>
                    update((p) => {
                      p.education.push({
                        id: crypto.randomUUID(),
                        institution: '',
                        degree: '',
                        field: '',
                        startDate: '',
                        endDate: '',
                        grade: '',
                        description: '',
                      });
                    })
                  }
                >
                  Add
                </Button>
              }
            >
              {draft.education.length === 0 ? (
                <p className="t-small text-muted">No education added.</p>
              ) : (
                <div className="col g3">
                  {draft.education.map((ed, i) => (
                    <EducationRow
                      key={ed.id}
                      value={ed}
                      onChange={(v) =>
                        update((p) => {
                          p.education[i] = v;
                        })
                      }
                      onRemove={() =>
                        update((p) => {
                          p.education.splice(i, 1);
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </Panel>
            <Panel
              title="Certifications"
              action={
                <Button
                  size="xs"
                  variant="ghost"
                  icon="plus"
                  onClick={() =>
                    update((p) => {
                      p.certifications.push({
                        id: crypto.randomUUID(),
                        name: '',
                        issuer: '',
                        date: '',
                        url: '',
                      });
                    })
                  }
                >
                  Add
                </Button>
              }
            >
              {draft.certifications.length === 0 ? (
                <p className="t-small text-muted">No certifications added.</p>
              ) : (
                <div className="col g2">
                  {draft.certifications.map((c, i) => (
                    <CertificationRow
                      key={c.id}
                      value={c}
                      onChange={(v) =>
                        update((p) => {
                          p.certifications[i] = v;
                        })
                      }
                      onRemove={() =>
                        update((p) => {
                          p.certifications.splice(i, 1);
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </Panel>
            <div className="grid grid-halves g4">
              <Panel title="Achievements">
                <LinesInput
                  aria-label="Achievements"
                  value={draft.achievements}
                  onChange={(v) =>
                    update((p) => {
                      p.achievements = v;
                    })
                  }
                />
              </Panel>
              <Panel title="Languages">
                <TagInput
                  aria-label="Languages"
                  value={draft.languages}
                  onChange={(v) =>
                    update((p) => {
                      p.languages = v;
                    })
                  }
                />
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="details">
          <AdditionalDetails />
        </TabsContent>

        <TabsContent value="resume">
          <MasterResumeTab profile={draft} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EducationRow({
  value,
  onChange,
  onRemove,
}: {
  value: Education;
  onChange: (v: Education) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-6 g2 items-center">
      <Input
        size="sm"
        aria-label="Institution"
        placeholder="Institution"
        value={value.institution}
        onChange={(e) => onChange({ ...value, institution: e.target.value })}
      />
      <Input
        size="sm"
        aria-label="Degree"
        placeholder="Degree"
        value={value.degree}
        onChange={(e) => onChange({ ...value, degree: e.target.value })}
      />
      <Input
        size="sm"
        aria-label="Field"
        placeholder="Field"
        value={value.field}
        onChange={(e) => onChange({ ...value, field: e.target.value })}
      />
      <Input
        size="sm"
        aria-label="Start"
        placeholder="Start (YYYY-MM)"
        value={value.startDate}
        onChange={(e) => onChange({ ...value, startDate: e.target.value })}
      />
      <Input
        size="sm"
        aria-label="End"
        placeholder="End"
        value={value.endDate}
        onChange={(e) => onChange({ ...value, endDate: e.target.value })}
      />
      <div className="row g1 items-center">
        <Input
          size="sm"
          aria-label="Grade"
          placeholder="Grade"
          value={value.grade}
          onChange={(e) => onChange({ ...value, grade: e.target.value })}
        />
        <IconButton
          icon="trash"
          size="sm"
          variant="danger"
          label="Remove education"
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

function CertificationRow({
  value,
  onChange,
  onRemove,
}: {
  value: Certification;
  onChange: (v: Certification) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-4 g2 items-center">
      <Input
        size="sm"
        aria-label="Name"
        placeholder="Name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Input
        size="sm"
        aria-label="Issuer"
        placeholder="Issuer"
        value={value.issuer}
        onChange={(e) => onChange({ ...value, issuer: e.target.value })}
      />
      <Input
        size="sm"
        aria-label="Date"
        placeholder="Date"
        value={value.date}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
      />
      <div className="row g1 items-center">
        <Input
          size="sm"
          aria-label="URL"
          placeholder="URL"
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
        />
        <IconButton
          icon="trash"
          size="sm"
          variant="danger"
          label="Remove certification"
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

function emptyExperience(): Experience {
  const now = new Date().toISOString();
  return {
    id: '',
    userId: '',
    company: '',
    role: '',
    location: '',
    startDate: '',
    endDate: null,
    description: '',
    technologies: [],
    achievements: [],
    projects: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ExperienceTab() {
  const list = useExperiences();
  const save = useSaveExperience();
  const del = useDeleteExperience();
  const [editing, setEditing] = useState<Experience | null>(null);
  return (
    <div className="col g4">
      <ErrorBanner error={save.error ?? del.error ?? list.error} />
      {editing ? (
        <Panel title={editing.id ? 'Edit experience' : 'New experience'}>
          <div className="grid grid-halves g3">
            <Field label="Company">
              <Input
                value={editing.company}
                onChange={(e) => setEditing({ ...editing, company: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <Input
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              />
            </Field>
            <Field label="Location">
              <Input
                value={editing.location}
                onChange={(e) => setEditing({ ...editing, location: e.target.value })}
              />
            </Field>
            <div className="row g2">
              <Field label="Start (YYYY-MM)" className="flex-1">
                <Input
                  value={editing.startDate}
                  onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                />
              </Field>
              <Field label="End (blank = current)" className="flex-1">
                <Input
                  value={editing.endDate ?? ''}
                  onChange={(e) => setEditing({ ...editing, endDate: e.target.value || null })}
                />
              </Field>
            </div>
          </div>
          <Field label="Description" className="mt3">
            <Textarea
              rows={3}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <Field label="Technologies" className="mt3">
            <TagInput
              value={editing.technologies}
              onChange={(v) => setEditing({ ...editing, technologies: v })}
            />
          </Field>
          <Field label="Achievements (one per line, real numbers only)" className="mt3">
            <LinesInput
              value={editing.achievements}
              onChange={(v) => setEditing({ ...editing, achievements: v })}
            />
          </Field>
          <div className="row justify-end g2 mt4">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!editing.company.trim() || !editing.role.trim()}
              onClick={() => save.mutate(editing, { onSuccess: () => setEditing(null) })}
            >
              Save
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="row justify-end">
          <Button
            size="sm"
            variant="subtle"
            icon="plus"
            onClick={() => setEditing(emptyExperience())}
          >
            Add experience
          </Button>
        </div>
      )}
      {list.data?.length === 0 && !editing ? (
        <EmptyState
          icon="briefcase"
          title="No experience yet"
          description="Add your employers, or import your master resume and let Claude parse it."
        />
      ) : null}
      {list.data?.map((e) => (
        <Panel key={e.id}>
          <div className="row justify-between items-start g3">
            <div style={{ minWidth: 0 }}>
              <h3 className="t-h4">
                {e.role} · {e.company}
              </h3>
              <div className="t-small text-muted">
                {e.startDate} – {e.endDate ?? 'Present'}
                {e.location ? ` · ${e.location}` : ''}
              </div>
              {e.description ? (
                <p className="selectable mt2" style={{ fontSize: 13.5, marginBottom: 0 }}>
                  {e.description}
                </p>
              ) : null}
              {e.technologies.length ? (
                <div className="t-caption mt2">{e.technologies.join(', ')}</div>
              ) : null}
              {e.achievements.length ? (
                <ul className="bullets mt2">
                  {e.achievements.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="row g1">
              <Button size="xs" variant="ghost" onClick={() => setEditing(e)}>
                Edit
              </Button>
              <IconButton
                icon="trash"
                size="sm"
                variant="danger"
                label={`Delete ${e.role} at ${e.company}`}
                onClick={() => del.mutate(e.id)}
              />
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function emptyProject(): Project {
  const now = new Date().toISOString();
  return {
    id: '',
    userId: '',
    experienceId: null,
    name: '',
    description: '',
    role: '',
    technologies: [],
    responsibilities: [],
    achievements: [],
    url: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * "Add with Claude": the candidate describes a project in their own words and
 * Claude drafts a full entry, which then opens in the normal editor for review.
 */
function DraftProjectPanel({
  onDrafted,
  onCancel,
}: {
  onDrafted: (p: Project) => void;
  onCancel: () => void;
}) {
  const experiences = useExperiences();
  const draft = useDraftProject();
  const [description, setDescription] = useState('');
  const [experienceId, setExperienceId] = useState('');
  return (
    <Panel title="Add a project with Claude">
      <p className="t-small text-muted mb3" style={{ marginTop: 0 }}>
        Describe the project in your own words: what it is, your role, what you built, the
        technologies, and any results. Claude turns it into a full entry using only what you write,
        and you can review it before saving. Tailored resumes use your projects automatically.
      </p>
      <ErrorBanner error={draft.error} />
      <Field label="Project description">
        <Textarea
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. At iBoon I led a team of 4 building a hospital appointment app in React and Node.js, with Razorpay payments and WhatsApp reminders…"
        />
      </Field>
      <Field
        label="Employer (optional; Claude picks it up from the description otherwise)"
        className="mt3"
      >
        <Select
          value={experienceId}
          onChange={(e) => setExperienceId(e.target.value)}
          style={{ maxWidth: 360 }}
        >
          <option value="">From the description</option>
          {experiences.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.company}
            </option>
          ))}
        </Select>
      </Field>
      <div className="row justify-end g2 mt4">
        <Button variant="ghost" onClick={onCancel} disabled={draft.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon="sparkles"
          loading={draft.isPending}
          disabled={description.trim().length < 10}
          onClick={() =>
            draft.mutate(
              { description, experienceId: experienceId || null },
              { onSuccess: onDrafted },
            )
          }
        >
          {draft.isPending ? 'Claude is drafting…' : 'Draft with Claude'}
        </Button>
      </div>
    </Panel>
  );
}

function ProjectsTab() {
  const list = useProjects();
  const experiences = useExperiences();
  const save = useSaveProject();
  const del = useDeleteProject();
  const [editing, setEditing] = useState<Project | null>(null);
  const [drafting, setDrafting] = useState(false);
  const employerName = (id: string | null) => experiences.data?.find((x) => x.id === id)?.company;
  return (
    <div className="col g4">
      <ErrorBanner error={save.error ?? del.error ?? list.error} />
      {drafting ? (
        <DraftProjectPanel
          onCancel={() => setDrafting(false)}
          onDrafted={(p) => {
            setDrafting(false);
            setEditing(p);
          }}
        />
      ) : editing ? (
        <Panel title={editing.id ? 'Edit project' : 'New project'}>
          <div className="grid grid-halves g3">
            <Field label="Name">
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="Your role">
              <Input
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              />
            </Field>
            <Field label="URL">
              <Input
                value={editing.url}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              />
            </Field>
            <Field label="Employer (optional)">
              <Select
                value={editing.experienceId ?? ''}
                onChange={(e) => setEditing({ ...editing, experienceId: e.target.value || null })}
              >
                <option value="">Personal / other</option>
                {experiences.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.company}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description" className="mt3">
            <Textarea
              rows={3}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <Field label="Technologies" className="mt3">
            <TagInput
              value={editing.technologies}
              onChange={(v) => setEditing({ ...editing, technologies: v })}
            />
          </Field>
          <div className="grid grid-halves g3 mt3">
            <Field label="Responsibilities">
              <LinesInput
                value={editing.responsibilities}
                onChange={(v) => setEditing({ ...editing, responsibilities: v })}
                rows={3}
              />
            </Field>
            <Field label="Achievements">
              <LinesInput
                value={editing.achievements}
                onChange={(v) => setEditing({ ...editing, achievements: v })}
                rows={3}
              />
            </Field>
          </div>
          <div className="row justify-end g2 mt4">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!editing.name.trim()}
              onClick={() => save.mutate(editing, { onSuccess: () => setEditing(null) })}
            >
              Save
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="row justify-end g2">
          <Button size="sm" variant="subtle" icon="plus" onClick={() => setEditing(emptyProject())}>
            Add project
          </Button>
          <Button size="sm" variant="primary" icon="sparkles" onClick={() => setDrafting(true)}>
            Add with Claude
          </Button>
        </div>
      )}
      {list.data?.length === 0 && !editing && !drafting ? (
        <EmptyState
          icon="layers"
          title="No projects yet"
          description="Projects help the agent pick relevant work for each resume."
        />
      ) : null}
      {list.data?.map((p) => (
        <Panel key={p.id}>
          <div className="row justify-between items-start g3">
            <div style={{ minWidth: 0 }}>
              <h3 className="t-h4">
                {p.name}
                {p.role ? (
                  <span className="text-muted" style={{ fontWeight: 400 }}>
                    {' '}
                    · {p.role}
                  </span>
                ) : null}
              </h3>
              {p.experienceId && employerName(p.experienceId) ? (
                <div className="t-caption">{employerName(p.experienceId)}</div>
              ) : null}
              {p.description ? (
                <p className="selectable mt1" style={{ fontSize: 13.5, marginBottom: 0 }}>
                  {p.description}
                </p>
              ) : null}
              {p.technologies.length ? (
                <div className="t-caption mt2">{p.technologies.join(', ')}</div>
              ) : null}
              {p.responsibilities.length || p.achievements.length ? (
                <ul className="bullets mt2 selectable">
                  {[...p.responsibilities, ...p.achievements].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="row g1">
              <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <IconButton
                icon="trash"
                size="sm"
                variant="danger"
                label={`Delete ${p.name}`}
                onClick={() => del.mutate(p.id)}
              />
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

/** Import the master resume (PDF/DOCX) and let Claude fill the profile from it. */
export function MasterResumeTab({
  profile,
  compact = false,
}: {
  profile: CandidateProfile;
  compact?: boolean;
}) {
  const importResume = useImportMasterResume();
  const parse = useParseMasterResume();
  const text = useMasterResumeText();
  const client = useHuntClient();
  const pick = async () => {
    if (!client.pickFiles) return;
    const [selected] = await client.pickFiles({
      multiple: false,
      filters: [{ name: 'Resume', extensions: ['pdf', 'docx'] }],
    });
    if (selected) importResume.mutate(selected);
  };
  const master = profile.masterResume;
  return (
    <div className="col g4">
      <ErrorBanner error={importResume.error ?? parse.error} />
      <Panel>
        <div className="row justify-between items-start g3 wrap">
          <div style={{ minWidth: 0 }}>
            <h3 className="t-h4">Master resume</h3>
            {master ? (
              <p className="t-small text-muted mt1" style={{ marginBottom: 0 }}>
                {master.originalFileName} · imported {formatDateTime(master.importedAt)} ·{' '}
                {master.textChars.toLocaleString()} characters extracted
                <br />
                Stored as {fileName(master.storedPath)} (the original file is never modified).
              </p>
            ) : (
              <p className="t-small text-muted mt1" style={{ marginBottom: 0 }}>
                Import your existing PDF or DOCX resume. It is the source of truth for every
                tailored resume the agent generates.
              </p>
            )}
          </div>
          <div className="row g2">
            {client.pickFiles ? (
              <Button
                size="sm"
                variant={master ? 'secondary' : 'primary'}
                icon="fileUp"
                onClick={() => void pick()}
                loading={importResume.isPending}
              >
                {master ? 'Replace' : 'Import resume'}
              </Button>
            ) : null}
            {master ? (
              <Button
                size="sm"
                variant="subtle"
                icon="sparkles"
                onClick={() => parse.mutate()}
                loading={parse.isPending}
              >
                Fill profile with Claude
              </Button>
            ) : null}
          </div>
        </div>
        {parse.isSuccess ? (
          <div className="mt3">
            <InfoBanner status="success" title="Profile updated">
              Empty fields were filled from your resume. Existing values were kept. Review the other
              tabs and save.
            </InfoBanner>
          </div>
        ) : null}
      </Panel>
      {!compact && text.data ? (
        <Panel title="Extracted text">
          <pre
            className="mono selectable pre-wrap scroll-y t-caption"
            style={{ maxHeight: 420, margin: 0 }}
          >
            {text.data}
          </pre>
        </Panel>
      ) : null}
    </div>
  );
}
