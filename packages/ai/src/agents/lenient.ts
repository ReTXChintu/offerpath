import { z } from 'zod';

/*
 * Forgiving contract pieces for long, free-form AI output. Length and range
 * limits never reach the model (strict structured output drops those
 * keywords, see strict-schema.ts), so a long topic or a priority of 4 is
 * normal, not a broken answer. Overlong text is shortened, numbers are pulled
 * into range and extra list items dropped, instead of failing a call that is
 * expensive to redo. Only a missing or empty field still fails.
 */

/** Trimmed and shortened to `max` characters, ending in an ellipsis when cut. */
export function text(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((s) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`));
}

/** Like `text`, but an empty string is fine. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .transform((s) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`));
}

/** Rounded and clamped into [min, max]. */
export function wholeNumber(min: number, max: number) {
  return z.number().transform((n) => Math.min(max, Math.max(min, Math.round(n))));
}

/** Clamped into [min, max] and rounded to one decimal. */
export function score(min: number, max: number) {
  return z.number().transform((n) => Math.min(max, Math.max(min, Math.round(n * 10) / 10)));
}

/** At least `min` items; anything past `max` is dropped. */
export function list<T extends z.ZodTypeAny>(item: T, min: number, max: number) {
  return z
    .array(item)
    .min(min)
    .transform((items) => items.slice(0, max));
}
