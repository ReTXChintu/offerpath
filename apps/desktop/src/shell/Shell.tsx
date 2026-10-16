import {
  AgentStatusBar,
  NotificationBell,
  UpdateBanner,
  syncLabel,
  useAboutInfo,
  useDashboard,
  useRemoteStatus,
  useSetupStatus,
  useStartJobHunt,
  useSyncStatus,
  useUpdateCheck,
} from '@offerpath/hunt';
import {
  AppShell,
  CommandPalette,
  Icon,
  Kbd,
  NavGroup,
  NavItem,
  Sidebar,
  SidebarBrand,
  StatusPill,
  ThemeToggle,
  TopBar,
  useCommandPaletteShortcut,
  useTheme,
  type Command,
} from '@offerpath/ui';
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BOTTOM, GROW, HUNT, MORE, PROGRESS, TODAY, isActive, type NavEntry } from './nav';
import { NavLink, toHref } from './NavLink';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** The desktop's frame: sidebar, top bar, the page, the agent's status bar. */
export function Shell() {
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const setup = useSetupStatus();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteShortcut(togglePalette);

  // First run: open the setup screen once, until setup is completed. Only
  // once per session, so the pages it links to (the profile) stay reachable.
  const sentToSetup = useRef(false);
  useEffect(() => {
    if (sentToSetup.current || !setup.data) return;
    sentToSetup.current = true;
    if (!setup.data.setupCompleted && path !== '/setup') router.history.push('/setup');
  }, [setup.data, path, router]);

  return (
    <AppShell
      sidebar={<AppSidebar path={path} />}
      topbar={<AppTopBar onOpenPalette={() => setPaletteOpen(true)} />}
      banner={<UpdateBanner />}
      statusbar={<AgentStatusBar />}
    >
      <Outlet />
      <AppCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </AppShell>
  );
}

function Item({ entry, path, badge }: { entry: NavEntry; path: string; badge?: number }) {
  return (
    <NavItem
      href={toHref(entry.path)}
      icon={entry.icon}
      label={entry.label}
      active={isActive(entry.path, path)}
      badge={badge}
      link={NavLink}
    />
  );
}

function AppSidebar({ path }: { path: string }) {
  const dashboard = useDashboard();
  const about = useAboutInfo();
  const update = useUpdateCheck();
  const d = dashboard.data;
  // Applications waiting for the user: approvals plus questions / manual steps.
  const waiting = d ? d.total.awaitingApproval + d.total.manualAction + d.total.waitingForUser : 0;

  return (
    <Sidebar
      footer={
        <>
          {BOTTOM.map((entry) => (
            <Item key={entry.path} entry={entry} path={path} />
          ))}
          <NavLink
            href="/about"
            className="row items-center g2 t-caption"
            style={{ padding: '8px 10px 0', textDecoration: 'none' }}
            title="About Offerpath"
          >
            <span>{about.data ? `v${about.data.version}` : 'About'}</span>
            {update.data?.available ? (
              <span className="dot dot-sm dot-primary" title="Update available" />
            ) : null}
          </NavLink>
        </>
      }
    >
      <SidebarBrand href="#/" />
      <Item entry={TODAY} path={path} />
      <NavGroup label={GROW.label}>
        {GROW.items.map((entry) => (
          <Item key={entry.path} entry={entry} path={path} />
        ))}
      </NavGroup>
      <NavGroup label={HUNT.label} href={HUNT.path ? toHref(HUNT.path) : undefined} link={NavLink}>
        {HUNT.items.map((entry) => (
          <Item
            key={entry.path}
            entry={entry}
            path={path}
            badge={entry.path === '/applications' ? waiting : undefined}
          />
        ))}
      </NavGroup>
      <div className="app-nav-group">
        <Item entry={PROGRESS} path={path} />
      </div>
    </Sidebar>
  );
}

function AppTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const sync = useSyncStatus();
  const remote = useRemoteStatus();
  const syncState = syncLabel(sync.data);
  const tone =
    syncState.tone === 'success' ? 'success' : syncState.tone === 'warning' ? 'warning' : 'neutral';
  const r = remote.data;
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
          <NavLink href="/settings" style={{ textDecoration: 'none' }}>
            <StatusPill tone={tone} title="Sync with your account">
              {syncState.text}
            </StatusPill>
          </NavLink>
          {r?.configured ? (
            <NavLink href="/settings" style={{ textDecoration: 'none' }}>
              <StatusPill
                tone={r.connected ? 'success' : 'warning'}
                title={
                  r.connected
                    ? 'Your phone and the web can reach this desktop'
                    : (r.lastError ?? 'Not connected to the server')
                }
              >
                {r.connected ? 'Desktop online' : 'Desktop offline'}
              </StatusPill>
            </NavLink>
          ) : null}
          <NotificationBell />
          <ThemeToggle />
        </>
      }
    />
  );
}

function AppCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setPreference } = useTheme();
  const start = useStartJobHunt();
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
      ...GROW.items.map((e) => go(e, 'Grow')),
      ...HUNT.items.map((e) => go(e, 'Hunt')),
      go(PROGRESS, 'Go to'),
      ...BOTTOM.map((e) => go(e, 'Go to')),
      ...MORE.map((e) => go(e, 'More')),
      {
        id: 'action:start-hunt',
        label: 'Start a job hunt',
        group: 'Actions',
        icon: 'play',
        keywords: 'run agent search apply',
        onSelect: () => start.mutate({}),
      },
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
  }, [router, setPreference, start]);
  return <CommandPalette open={open} onOpenChange={onOpenChange} commands={commands} />;
}
