import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
  type TableHTMLAttributes,
} from 'react';

import { cx } from '../cx';
import { type IconName, Icon } from './Icon';
import { Logo } from './Logo';

// ---- Table ------------------------------------------------------------------------------

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Rows highlight on hover and show a pointer (they open something). */
  interactive?: boolean;
  /** Drop the bordered wrapper (inside a card that already has one). */
  bare?: boolean;
}

/** A data table. Write the thead/tbody yourself; this adds the look and the scroll box. */
export function Table({ interactive, bare, className, children, ...rest }: TableProps) {
  const table = (
    <table className={cx('table', interactive && 'interactive', className)} {...rest}>
      {children}
    </table>
  );
  return bare ? table : <div className="table-wrap">{table}</div>;
}

// ---- App shell --------------------------------------------------------------------------

/** Sidebar on the left; top bar, content and status bar on the right. */
export function AppShell({
  sidebar,
  topbar,
  statusbar,
  banner,
  children,
}: {
  sidebar: ReactNode;
  topbar?: ReactNode;
  statusbar?: ReactNode;
  /** A strip above the content (an update, an offline notice). */
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      {sidebar}
      <div className="app-main">
        {topbar}
        {banner}
        <main className="app-content" id="main">
          <div className="app-content-inner">{children}</div>
        </main>
        {statusbar}
      </div>
    </div>
  );
}

export function Sidebar({
  children,
  footer,
  label = 'Main',
}: {
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
}) {
  return (
    <aside className="app-sidebar">
      <nav className="app-nav" aria-label={label}>
        {children}
      </nav>
      {footer ? <div className="app-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

/** The logo and product name at the top of the sidebar. */
export function SidebarBrand({ name = 'Offerpath', href }: { name?: string; href?: string }) {
  const content = (
    <>
      <Logo size={28} title={null} />
      <span className="name">{name}</span>
    </>
  );
  return href ? (
    <a className="app-brand" href={href}>
      {content}
    </a>
  ) : (
    <div className="app-brand">{content}</div>
  );
}

/** Props a router link component receives from NavItem / NavGroup. */
export type NavLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export function NavGroup({
  label,
  href,
  link: LinkComponent,
  children,
}: {
  label: string;
  /** Makes the group's label a link (an overview page). */
  href?: string;
  link?: ComponentType<NavLinkProps>;
  children: ReactNode;
}) {
  const A = LinkComponent ?? 'a';
  return (
    <div className="app-nav-group" role="group" aria-label={label}>
      {href ? (
        <A className="app-nav-group-label" href={href}>
          {label}
          <Icon name="chevronRight" size={12} />
        </A>
      ) : (
        <div className="app-nav-group-label">{label}</div>
      )}
      <div className="app-nav">{children}</div>
    </div>
  );
}

export interface NavItemProps {
  href: string;
  icon: IconName;
  label: string;
  active?: boolean;
  /** A count shown on the right (things waiting for the user). */
  badge?: number;
  /** Render with a router's link component instead of a plain anchor. */
  link?: ComponentType<NavLinkProps>;
}

export const NavItem = forwardRef<HTMLAnchorElement, NavItemProps>(function NavItem(
  { href, icon, label, active, badge, link: LinkComponent },
  ref,
) {
  const props: NavLinkProps = {
    href,
    className: cx('app-nav-item', active && 'active'),
    'aria-current': active ? 'page' : undefined,
  };
  const children = (
    <>
      <Icon name={icon} />
      <span className="label">{label}</span>
      {badge ? (
        <span className="nav-badge" aria-label={`${badge} waiting`}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </>
  );
  return LinkComponent ? (
    <LinkComponent {...props}>{children}</LinkComponent>
  ) : (
    <a ref={ref} {...props}>
      {children}
    </a>
  );
});

export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="app-topbar">
      <div className="row items-center g3" style={{ minWidth: 0 }}>
        {left}
      </div>
      <div className="row items-center g2">{right}</div>
    </header>
  );
}

export function StatusBar({ children, label = 'Status' }: { children: ReactNode; label?: string }) {
  return (
    <footer className="app-statusbar" role="status" aria-label={label}>
      {children}
    </footer>
  );
}

/** A small rounded status label (sync state, desktop state) for the top or status bar. */
export function StatusPill({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className="status-pill" title={title}>
      <span className={cx('dot dot-sm', tone !== 'neutral' && `dot-${tone}`)} aria-hidden />
      {children}
    </span>
  );
}
