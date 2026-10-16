import { Button, Spinner, useTheme } from '@offerpath/ui';

import { errorMessage } from '../client';
import { fileName } from '../logic';
import { useOpenPath, useTextFile } from '../queries';
import type { CoverLetter, Resume } from '../types';

/** Renders the generated HTML resume inside a sandboxed iframe. */
export function HtmlPreview({
  path,
  height = '720px',
}: {
  path: string | null | undefined;
  height?: string;
}) {
  const file = useTextFile(path);
  const { resolved } = useTheme();
  if (!path) return <p className="t-small text-muted">No preview available.</p>;
  if (file.isLoading) return <Spinner size="sm" label="Loading preview" />;
  if (file.error)
    return <p className="t-small text-error">Could not load preview: {errorMessage(file.error)}</p>;
  const html = (file.data ?? '').replace(
    '</head>',
    `<style>html{background:${resolved === 'dark' ? '#2a2c33' : '#e5e7eb'};padding:16px 0}.page{background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25)}</style></head>`,
  );
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
        background: 'var(--surface-2)',
      }}
    >
      <iframe
        title="Document preview"
        sandbox=""
        srcDoc={html}
        style={{ width: '100%', height, border: 0, display: 'block' }}
      />
    </div>
  );
}

/** Buttons that open the generated files in their default app. */
export function FileLinks({
  resume,
  coverLetter,
}: {
  resume?: Resume | null;
  coverLetter?: CoverLetter | null;
}) {
  const open = useOpenPath();
  const links: { label: string; path: string | null | undefined }[] = [
    { label: 'Resume PDF', path: resume?.pdfPath },
    { label: 'Resume DOCX', path: resume?.docxPath },
    { label: 'Cover letter PDF', path: coverLetter?.pdfPath },
    { label: 'Cover letter DOCX', path: coverLetter?.docxPath },
  ];
  const available = links.filter((l): l is { label: string; path: string } => !!l.path);
  if (!available.length) return null;
  return (
    <div className="row g2 wrap">
      {available.map((l) => (
        <Button
          key={l.label}
          size="xs"
          icon="externalLink"
          onClick={() => open.mutate(l.path)}
          title={fileName(l.path)}
        >
          {l.label}
        </Button>
      ))}
    </div>
  );
}
