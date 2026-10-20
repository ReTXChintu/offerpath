import { CvService, MAX_CV_BYTES } from './cv.service.js';

/** A one-page PDF with one line of text, xref offsets and all. */
function minimalPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

/** The validation message a refused file carries. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const body = (error as { getResponse(): { errors: { file: string[] } } }).getResponse();
    return body.errors.file[0]!;
  }
  throw new Error('expected the file to be refused');
}

describe('CvService.extract', () => {
  // Extraction never touches the database.
  const cv = new CvService(null as never);
  const line = 'Jane Doe - Senior backend engineer, Node.js and PostgreSQL';

  it('reads the text out of a PDF, without page markers', async () => {
    // pdf.js loads its worker with a dynamic import: the test script runs
    // jest with --experimental-vm-modules for exactly this.
    const out = await cv.extract('jane.pdf', b64(minimalPdf(line)));
    expect(out).toEqual({ text: line, fileName: 'jane.pdf', chars: line.length });
  });

  it('reads text and markdown files, tidying the whitespace', async () => {
    const out = await cv.extract('cv.md', b64(`  # Jane\r\n\r\n\r\n\r\n${line}\t\t here  `));
    expect(out.text).toBe(`# Jane\n\n${line} here`);
  });

  it('refuses other types, empty and oversized files, and text-less PDFs', async () => {
    expect(await refusal(cv.extract('cv.png', b64('x'.repeat(100))))).toContain(
      'PDF, DOCX, TXT or MD',
    );
    expect(await refusal(cv.extract('cv.txt', ''))).toBe('The file is empty.');
    expect(
      await refusal(cv.extract('cv.txt', Buffer.alloc(MAX_CV_BYTES + 1).toString('base64'))),
    ).toBe('The file is larger than 4 MB.');
    expect(await refusal(cv.extract('scan.pdf', b64(minimalPdf(''))))).toContain('scanned PDF');
    expect(await refusal(cv.extract('broken.docx', b64('not a zip')))).toContain(
      'could not be read',
    );
  });
});
