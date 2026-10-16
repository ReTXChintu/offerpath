/**
 * Where the API is. `VITE_OFFERPATH_API_URL` wins when it is set at build
 * time. Otherwise: in development the Vite proxy forwards `/api` to the API
 * on 50005, so `/api/v1` on the page's own origin; in production the web app
 * (50004) and the API (50005) share a host but not a port, so the API is
 * the same host on 50005.
 */
export function apiBaseUrl(
  env: { VITE_OFFERPATH_API_URL?: string; DEV?: boolean } = import.meta.env,
  location: Pick<Location, 'protocol' | 'hostname'> = window.location,
): string {
  const configured = env.VITE_OFFERPATH_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (env.DEV) return '/api/v1';
  return `${location.protocol}//${location.hostname}:50005/api/v1`;
}

/** The API's origin, for links the API hands out as paths (`/api/v1/downloads/...`). */
export function apiOrigin(base: string, pageOrigin: string = window.location.origin): string {
  return new URL(base, pageOrigin).origin;
}
