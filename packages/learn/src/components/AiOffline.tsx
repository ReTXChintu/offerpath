import { Alert } from '@offerpath/ui';

import { ApiError, isAiUnavailable } from '../lib/api';

/**
 * AI runs on the user's own desktop. When it is offline the API answers
 * `ai-unavailable`, which is a state to explain, not an error to show.
 */
export const AI_OFFLINE_MESSAGE =
  'Your desktop is offline: AI and job hunting wait for it. Practice and recall still work.';

/** What to tell the user about a failed request. */
export function describeError(
  error: unknown,
  fallback = 'That did not get through. Try again.',
): string {
  if (isAiUnavailable(error)) return AI_OFFLINE_MESSAGE;
  if (error instanceof ApiError) return error.message;
  return fallback;
}

/** The offline-desktop notice, in the flow of the page. */
export function AiOfflineNotice({ className }: { className?: string }) {
  return (
    <Alert status="info" title="AI is waiting for your desktop" className={className}>
      {AI_OFFLINE_MESSAGE}
    </Alert>
  );
}

/**
 * A failed request: the offline-desktop notice when that is the cause,
 * otherwise the error itself.
 */
export function RequestError({
  error,
  fallback,
  className,
}: {
  error: unknown;
  fallback?: string;
  className?: string;
}) {
  if (!error) return null;
  if (isAiUnavailable(error)) return <AiOfflineNotice className={className} />;
  return (
    <Alert status="error" className={className}>
      {describeError(error, fallback)}
    </Alert>
  );
}
