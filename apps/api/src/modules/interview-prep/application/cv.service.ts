import { Injectable } from '@nestjs/common';

import { ProblemException, Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/** The largest CV file accepted, before base64. */
export const MAX_CV_BYTES = 4 * 1024 * 1024;
/** CV text kept for prompts; a real CV is a few thousand characters. */
export const MAX_CV_CHARS = 30_000;

export interface ExtractedCv {
  text: string;
  fileName: string;
  chars: number;
}

type Doc = Record<string, unknown>;

/**
 * The CV a prep interviews with, as text: pulled out of an uploaded PDF,
 * DOCX or text file, or written from the user's synced Offerpath profile
 * (the desktop's candidate profile, experiences and projects).
 */
@Injectable()
export class CvService {
  constructor(private readonly prisma: PrismaService) {}

  async extract(fileName: string, contentBase64: string): Promise<ExtractedCv> {
    const name = fileName.trim().slice(0, 200) || 'cv';
    const extension = name.toLowerCase().split('.').pop() ?? '';
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.length === 0) throw invalid('The file is empty.');
    if (bytes.length > MAX_CV_BYTES) throw invalid('The file is larger than 4 MB.');

    let raw: string;
    try {
      if (extension === 'pdf') raw = await pdfText(bytes);
      else if (extension === 'docx') raw = await docxText(bytes);
      else if (extension === 'txt' || extension === 'md') raw = bytes.toString('utf8');
      else throw invalid('Upload a PDF, DOCX, TXT or MD file.');
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      throw invalid(`The file could not be read (${describe(error)}).`);
    }

    const text = tidy(raw);
    if (text.length < 40) {
      throw invalid(
        'No text came out of this file. A scanned PDF has none: paste the text instead.',
      );
    }
    return { text, fileName: name, chars: text.length };
  }

  /** A plain-text CV from the synced profile, or null when there is none. */
  async fromProfile(userId: string): Promise<string | null> {
    const docs = await this.prisma.syncDocument.findMany({
      where: {
        userId,
        deletedAt: null,
        collection: { in: ['candidate_profiles', 'experiences', 'projects'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const profile = docs.find((d) => d.collection === 'candidate_profiles')?.doc as Doc | undefined;
    const experiences = docs
      .filter((d) => d.collection === 'experiences')
      .map((d) => d.doc as Doc)
      .sort((a, b) => str(b.startDate).localeCompare(str(a.startDate)));
    const projects = docs.filter((d) => d.collection === 'projects').map((d) => d.doc as Doc);

    const sections: string[] = [];
    if (profile) {
      const personal = (profile.personal ?? {}) as Doc;
      // No contact details: the interviewer doesn't need them.
      const head = [str(personal.name), str(personal.currentTitle), str(personal.location)]
        .filter(Boolean)
        .join(' · ');
      if (head) sections.push(head);
      if (str(profile.summary)) sections.push(`Summary\n${str(profile.summary)}`);
      const skills = Object.entries((profile.skills ?? {}) as Record<string, unknown>)
        .map(([group, list]) => [group, strings(list)] as const)
        .filter(([, list]) => list.length > 0)
        .map(([group, list]) => `${capitalise(group)}: ${list.join(', ')}`);
      if (skills.length > 0) sections.push(`Skills\n${skills.join('\n')}`);
    }
    if (experiences.length > 0) {
      sections.push(
        `Experience\n${experiences
          .map((e) =>
            [
              `${str(e.role)} at ${str(e.company)} (${str(e.startDate)} – ${str(e.endDate) || 'present'})`,
              str(e.description),
              ...strings(e.achievements).map((a) => `- ${a}`),
              strings(e.technologies).length > 0
                ? `Technologies: ${strings(e.technologies).join(', ')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')}`,
      );
    }
    if (projects.length > 0) {
      sections.push(
        `Projects\n${projects
          .map((p) =>
            [
              `${str(p.name)}${str(p.role) ? ` (${str(p.role)})` : ''}`,
              str(p.description),
              ...strings(p.achievements).map((a) => `- ${a}`),
              strings(p.technologies).length > 0
                ? `Technologies: ${strings(p.technologies).join(', ')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')}`,
      );
    }
    if (profile) {
      const education = Array.isArray(profile.education) ? (profile.education as Doc[]) : [];
      if (education.length > 0) {
        sections.push(
          `Education\n${education
            .map((e) =>
              [str(e.degree), str(e.field), str(e.institution), str(e.endDate)]
                .filter(Boolean)
                .join(', '),
            )
            .join('\n')}`,
        );
      }
      const achievements = strings(profile.achievements);
      if (achievements.length > 0) {
        sections.push(`Achievements\n${achievements.map((a) => `- ${a}`).join('\n')}`);
      }
    }

    const text = tidy(sections.join('\n\n'));
    // A name alone isn't a CV.
    return text.length >= 80 ? text : null;
  }
}

async function pdfText(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function docxText(bytes: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  return (await mammoth.extractRawText({ buffer: bytes })).value;
}

/** Normalised whitespace, page markers gone, capped. */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/^-- \d+ of \d+ --$/gm, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CV_CHARS);
}

function invalid(message: string) {
  return Problems.validation({ file: [message] });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : 'unknown error';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
