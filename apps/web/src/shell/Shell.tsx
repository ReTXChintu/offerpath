import { useApplications } from '@offerpath/hunt';
import { DesktopOfflineStrip, useOnboardingStatus } from '@offerpath/learn';
import {
  AppShell,
  CommandPalette,
  Icon,
  Kbd,
  NavGroup,
  NavItem,
  Sidebar,
  SidebarBrand,
  ThemeToggle,
  TopBar,
  useCommandPaletteShortcut,
  useTheme,
  type Command,
  type NavLinkProps,
} from '@offerpath/ui';
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import { useAuth } from '../auth-context';

import {
  GET_APPS,
  GROW,
  HUNT,
  NEW_PREP,
  PROGRESS,
  SETTINGS,
  TODAY,
  isActive,
  isFullBleed,
  type NavEntry,
} from './nav';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** An anchor that navigates through the router. */
export function NavLink({ href, onClick, children, ...rest }: NavLinkProps) {
  const router = useRouter();
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.history.push(href);
  };
  return (
    <a href={href} onClick={go} {...rest}>
      {children}
    </a>
  );
}

/** Applications waiting for the user: approvals, questions and manual steps. */
function useWaitingCount(): number {
  const applications = useApplications();
  return (applications.data ?? []).filter((item) =>
    ['READY_FOR_REVIEW', 'WAITING_FOR_USER', 'MANUAL_ACTION_REQUIRED'].includes(
      item.application.status,
    ),
  ).length;
}

/** The web app's frame: a lighter shell than the desktop's (plan 5.3). */
export function Shell() {
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteShortcut(togglePalette);

  // First visit after signing up: the onboarding, once.
  const onboarding = useOnboardingStatus();
  const sentToOnboarding = useRef(false);
  useEffect(() => {
    if (sentToOnboarding.current || !onboarding.data) return;
    sentToOnboarding.current = true;
    if (!onboarding.data.completed && path === '/') router.history.push('/onboarding');
  }, [onboarding.data, path, router]);

  return (
    <AppShell
      sidebar={<WebSidebar path={path} />}
      topbar={<WebTopBar onOpenPalette={() => setPaletteOpen(true)} />}
      banner={<DesktopOfflineStrip />}
      flush={isFullBleed(path)}
    >
      <Outlet />
      <WebCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </AppShell>
  );
}

function Item({ entry, path, badge }: { entry: NavEntry; path: string; badge?: number }) {
  return (
    <NavItem
      href={entry.path}
      icon={entry.icon}
      label={entry.label}
      active={isActive(entry.path, path)}
      badge={badge}
      link={NavLink}
    />
  );
}

function WebSidebar({ path }: { path: string }) {
  const waiting = useWaitingCount();
  const { auth } = useAuth();
  return (
    <Sidebar
      footer={
        <>
          <Item entry={GET_APPS} path={path} />
          <Item entry={SETTINGS} path={path} />
          <button
            type="button"
            className="app-nav-item"
            onClick={() => void auth.logout()}
            style={{ width: '100%', background: 'none', border: 0, font: 'inherit' }}
          >
            <Icon name="logout" size={17} />
            <span>Sign out</span>
          </button>
        </>
      }
    >
      <SidebarBrand href="/" />
      <Item entry={TODAY} path={path} />
      <NavGroup label="Grow">
        {GROW.map((entry) => (
          <Item key={entry.path} entry={entry} path={path} />
        ))}
      </NavGroup>
      <NavGroup label="Hunt">
        {HUNT.map((entry) => (
          <Item
            key={entry.path}
            entry={entry}
            path={path}
            badge={entry.path === '/hunt' ? waiting : undefined}
          />
        ))}
      </NavGroup>
      <div className="app-nav-group">
        <Item entry={PROGRESS} path={path} />
      </div>
    </Sidebar>
  );
}

function WebTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { session } = useAuth();
  return (
    <TopBar
      left={
        <button
          type="button"
          className="searchbar-trigger"
          onClick={onOpenPalette}
          aria-label="Search pages and actions"
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        >
          <Icon name="search" size={15} />
          <span className="flex-1" style={{ textAlign: 'left' }}>
            Search or jump to…
          </span>
          <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
        </button>
      }
      right={
        <>
          <span className="t-caption" title="Signed in">
            {session.email}
          </span>
          <ThemeToggle />
        </>
      }
    />
  );
}

function WebCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setPreference } = useTheme();
  const commands = useMemo<Command[]>(() => {
    const go = (entry: NavEntry, group: string): Command => ({
      id: `go:${entry.path}`,
      label: entry.label,
      group,
      icon: entry.icon,
      keywords: entry.keywords,
      onSelect: () => router.history.push(entry.path),
    });
    return [
      go(TODAY, 'Go to'),
      ...GROW.map((e) => go(e, 'Grow')),
      go(NEW_PREP, 'Grow'),
      ...HUNT.map((e) => go(e, 'Hunt')),
      go(PROGRESS, 'Go to'),
      go(SETTINGS, 'Go to'),
      go(GET_APPS, 'Go to'),
      {
        id: 'theme:light',
        label: 'Theme: light',
        group: 'Actions',
        icon: 'sun',
        onSelect: () => setPreference('light'),
      },
      {
        id: 'theme:dark',
        label: 'Theme: dark',
        group: 'Actions',
        icon: 'moon',
        onSelect: () => setPreference('dark'),
      },
      {
        id: 'theme:system',
        label: 'Theme: follow the system',
        group: 'Actions',
        icon: 'monitor',
        onSelect: () => setPreference('system'),
      },
    ];
  }, [router, setPreference]);
  return <CommandPalette open={open} onOpenChange={onOpenChange} commands={commands} />;
}
