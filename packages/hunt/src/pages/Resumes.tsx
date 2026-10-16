import { Button, EmptyState, PageHeader, Panel, Table } from '@offerpath/ui';
import { useState } from 'react';

import { useHuntNavigator } from '../client';
import { ErrorBanner } from '../components/common';
import { HtmlPreview } from '../components/DocumentPreview';
import { formatDateTime } from '../logic';
import { useOpenPath, useProfile, useResumes } from '../queries';
import { MasterResumeTab } from './Candidate';

export function ResumesPage() {
  const resumes = useResumes();
  const profile = useProfile();
  const open = useOpenPath();
  const nav = useHuntNavigator();
  const [selected, setSelected] = useState<string | null>(null);
  const list = resumes.data ?? [];
  const current = list.find((r) => r.id === selected) ?? list[0];

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title="Resumes"
        subtitle="Your master resume and every tailored version the agent generated, grouped per company."
      />
      <ErrorBanner error={resumes.error} onRetry={() => void resumes.refetch()} />
      {profile.data ? (
        <div className="mb6">
          <MasterResumeTab profile={profile.data} compact />
        </div>
      ) : null}
      {list.length === 0 ? (
        <EmptyState
          icon="fileText"
          title="No generated resumes yet"
          description="Tailored resumes appear here once the agent prepares applications."
        />
      ) : (
        <div className="grid grid-halves g6">
          <Panel flush title="Generated versions">
            <Table interactive bare>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Version</th>
                  <th>ATS</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Files</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    className={current?.id === r.id ? 'selected' : undefined}
                    aria-selected={current?.id === r.id}
                    onClick={() => setSelected(r.id)}
                  >
                    <td>
                      <div className="cell-title">{r.company}</div>
                      <div className="t-caption">{r.jobTitle}</div>
                    </td>
                    <td>
                      v{r.version}
                      {r.userEdited ? ' (edited)' : ''}
                    </td>
                    <td>
                      {r.validation ? (
                        <span
                          className={
                            r.validation.status === 'PASS' ? 'text-success' : 'text-warning'
                          }
                        >
                          {r.validation.status} · {r.validation.keywordCoverage}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="t-caption">{formatDateTime(r.createdAt)}</td>
                    <td>
                      <div className="row g1">
                        {r.pdfPath ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (r.pdfPath) open.mutate(r.pdfPath);
                            }}
                          >
                            PDF
                          </Button>
                        ) : null}
                        {r.docxPath ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (r.docxPath) open.mutate(r.docxPath);
                            }}
                          >
                            DOCX
                          </Button>
                        ) : null}
                        {r.jobId ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            icon="externalLink"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (r.jobId) nav.navigate({ to: 'job', jobId: r.jobId });
                            }}
                          >
                            Job
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          <div>{current ? <HtmlPreview path={current.htmlPath} height="760px" /> : null}</div>
        </div>
      )}
    </div>
  );
}
