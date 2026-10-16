import type { NavLinkProps } from '@offerpath/ui';
import { useRouter } from '@tanstack/react-router';
import type { MouseEvent } from 'react';

/** "/jobs" → "#/jobs": the desktop uses hash history. */
export const toHref = (path: string) => (path.startsWith('#') ? path : `#${path}`);

/**
 * An anchor that navigates through the router. Takes an app path
 * ("/jobs") or a hash href ("#/jobs").
 */
export function NavLink({ href, onClick, children, ...rest }: NavLinkProps) {
  const router = useRouter();
  const path = href.replace(/^#/, '');
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.history.push(path);
  };
  return (
    <a href={toHref(path)} onClick={go} {...rest}>
      {children}
    </a>
  );
}
