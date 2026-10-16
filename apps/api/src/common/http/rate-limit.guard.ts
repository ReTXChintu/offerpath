import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { Problems } from './problem-details.js';

const WINDOW_MS = 60_000;
const LIMIT = 10;

/**
 * At most 10 requests a minute per client address per route.
 *
 * Sign-up is open, so sign-up, sign-in and pairing are the endpoints anyone
 * on the internet can reach without a credential; this keeps password
 * guessing and account spam slow. In memory, like the hub: the API is one
 * process. Proxied requests count by the first X-Forwarded-For address.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const key = `${clientAddress(request)} ${request.method} ${request.route?.path ?? request.path}`;

    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= LIMIT) {
      throw Problems.rateLimited(Math.ceil((WINDOW_MS - (now - recent[0]!)) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.sweep(now);
    return true;
  }

  /** Drops idle keys now and then, so the map doesn't grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < WINDOW_MS) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= WINDOW_MS)) this.hits.delete(key);
    }
  }
}

function clientAddress(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
  return first || request.ip || 'unknown';
}
