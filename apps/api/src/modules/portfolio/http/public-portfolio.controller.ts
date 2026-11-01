import { Body, Controller, Get, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { PortfolioService } from '../application/portfolio.service.js';
import type { SiteData } from '../domain/site.js';

/** The old admin's contact rules, with an upper bound and the honeypot. */
const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().email('Enter a valid email').max(254),
  message: z.string().trim().min(10, 'Message is too short').max(5_000),
  website: z.string().max(500).optional(),
});

type Envelope = { ok: true; data?: SiteData } | { ok: false; error: string };

/**
 * The public portfolio API any portfolio site reads (docs/portfolio.md): no
 * auth, open CORS (set for `/public` in main.ts), and every answer in the
 * `{ ok, ... }` envelope portfolio sites expect, never problem details.
 */
@ApiTags('portfolio')
@Controller('public/portfolio')
export class PublicPortfolioController {
  constructor(private readonly portfolios: PortfolioService) {}

  @Get(':handle/site')
  @ApiOperation({ summary: "A portfolio's published content, for its site" })
  async site(
    @Param('handle') handle: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope> {
    try {
      const data = await this.portfolios.site(handle.toLowerCase());
      if (!data) return fail(res, HttpStatus.NOT_FOUND, 'Portfolio not found');
      res.set('Cache-Control', 'no-store');
      return { ok: true, data };
    } catch {
      return fail(res, HttpStatus.SERVICE_UNAVAILABLE, 'Unable to load site data');
    }
  }

  @Post(':handle/contact')
  @ApiOperation({ summary: "A message from a portfolio site's contact form" })
  async contact(
    @Param('handle') handle: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope> {
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        res,
        HttpStatus.BAD_REQUEST,
        parsed.error.issues[0]?.message ?? 'Invalid payload',
      );
    }
    try {
      const outcome = await this.portfolios.contact(
        handle.toLowerCase(),
        visitorOf(req),
        parsed.data,
      );
      if (outcome === 'not-found') return fail(res, HttpStatus.NOT_FOUND, 'Portfolio not found');
      if (outcome === 'limited') {
        return fail(res, HttpStatus.TOO_MANY_REQUESTS, 'Too many messages. Try again later.');
      }
      res.status(HttpStatus.OK);
      return { ok: true };
    } catch {
      return fail(res, HttpStatus.SERVICE_UNAVAILABLE, 'The message could not be sent. Try again.');
    }
  }
}

function fail(res: Response, status: HttpStatus, error: string): Envelope {
  res.status(status);
  return { ok: false, error };
}

/** The visitor's IP, through a proxy: Netlify's header, then X-Forwarded-For, then the socket. */
function visitorOf(req: Request): string {
  const netlify = req.headers['x-nf-client-connection-ip'];
  if (typeof netlify === 'string' && netlify) return netlify.trim();
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}
