import { useQueryClient } from '@tanstack/react-query';
import { Award, Bell, BookOpen, CalendarDays, ChevronRight, Compass, ExternalLink, Home, LogOut, Mail, MoreHorizontal, Trophy, UserRound, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { useSession } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { useCatalog, useNotificationActions, useNotifications, type LearnNotification } from '../lib/learn';
import { useAcademy, useMe } from '../lib/queries';
import { AcademyMark, Avatar } from './kit';
import { CountBadge, Skeleton } from './ui';

/**
 * The learner app's frame: a calm top bar with the academy's mark, the main
 * sections, notifications and the account menu; a bottom tab bar on phones;
 * and a quiet footer.
 */

type NavItem = { to: string; label: string; short: string; icon: typeof Home; end?: boolean; badge?: number; badgeLabel?: string; match?: (path: string) => boolean; desktopOnly?: boolean };

function useNavItems() {
  const me = useMe();
  const selfEnrollment = Boolean(me.data?.features.selfEnrollment);
  // With self-enrollment off the catalog is still worth showing when there's something to browse.
  const catalog = useCatalog({}, { enabled: Boolean(me.data) && !selfEnrollment });
  const hasCatalog = selfEnrollment || (catalog.data?.total ?? 0) > 0;
  const attention = (me.data?.counts.overdue ?? 0) + (me.data?.counts.dueSoon ?? 0);
  const items: NavItem[] = [
    { to: '/', label: 'Home', short: 'Home', icon: Home, end: true },
    { to: '/learning', label: 'My learning', short: 'Learning', icon: BookOpen, badge: attention, badgeLabel: `${attention} due soon or overdue`, match: p => p.startsWith('/learning') },
    ...(hasCatalog ? [{ to: '/catalog', label: 'Catalog', short: 'Catalog', icon: Compass }] : []),
    { to: '/sessions', label: 'Sessions', short: 'Sessions', icon: CalendarDays },
    { to: '/certificates', label: 'Certificates', short: 'Certificates', icon: Award },
    // Managers check on their team often enough that it belongs beside their own learning.
    ...(me.data?.isManager ? [{ to: '/team', label: 'My team', short: 'Team', icon: Users, desktopOnly: true }] : []),
  ];
  return { items, hasCatalog };
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  // A new page starts at the top, like any website.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <TopBar />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <Footer />
      <BottomTabs />
    </div>
  );
}

function useSignOut() {
  const { signOut } = useSession();
  const qc = useQueryClient();
  return () => {
    qc.removeQueries({ predicate: q => q.queryKey[0] !== 'academy' });
    signOut();
  };
}

function TopBar() {
  const me = useMe();
  const { data: academy } = useAcademy();
  const { items } = useNavItems();
  const location = useLocation();
  const name = me.data?.settings.academyName ?? academy?.academyName ?? 'Academy';

  return (
    <header className="no-print sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-page items-center gap-3 px-4 sm:px-6 md:h-16">
        <Link to="/" className="-mx-1.5 flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-label={`${name} home`}>
          <AcademyMark size={30} />
          <span className="truncate font-serif text-[17px] font-semibold md:max-lg:sr-only md:text-lg">{name}</span>
        </Link>

        <nav aria-label="Main" className="ml-4 hidden h-full items-center gap-4 md:flex lg:ml-6 lg:gap-5">
          {items.map(item => {
            const active = item.match ? item.match(location.pathname) : undefined;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative inline-flex h-full items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35',
                    item.desktopOnly && 'hidden lg:inline-flex',
                    (active ?? isActive) ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {item.label}
                {item.badge ? <CountBadge count={item.badge} label={item.badgeLabel} className={cn(me.data?.counts.overdue ? 'bg-tone-danger text-white dark:text-[hsl(240_10%_6%)]' : undefined)} /> : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <NotificationBell />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────

function NotificationBell() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const list = useNotifications('all', 8, { enabled: open });
  const actions = useNotificationActions();
  const unread = me.data?.counts.unreadNotifications ?? 0;
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const openItem = (n: LearnNotification) => {
    if (!n.readAt) actions.mutate({ action: 'read', ids: [n.id] });
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground ring-2 ring-background" aria-hidden>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] overflow-hidden rounded-xl p-0 shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-serif text-lg font-semibold">Notifications</h2>
          <button
            type="button"
            disabled={!unread || actions.isPending}
            onClick={() => actions.mutate({ action: 'read_all' })}
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary/[0.08] disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-[min(60vh,440px)] overflow-y-auto" aria-live="polite">
          {list.isPending ? (
            <div className="space-y-3 p-4" aria-label="Loading notifications">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : list.isError ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Notifications didn't load. Try again in a moment.</p>
          ) : list.data.items.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Bell className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 font-medium">You're all caught up</p>
              <p className="mt-0.5 text-sm text-muted-foreground">New assignments, grades and certificates will show up here.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {list.data.items.map(n => (
                <li key={n.id}>
                  <NotificationRow n={n} onOpen={() => openItem(n)} compact />
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link to="/notifications" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-1 border-t text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35">
          See all notifications <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationRow({ n, onOpen, compact, trailing }: { n: LearnNotification; onOpen: () => void; compact?: boolean; trailing?: ReactNode }) {
  return (
    <div className={cn('group relative flex gap-3 transition-colors hover:bg-accent/60', compact ? 'px-4 py-3' : 'px-4 py-4 sm:px-5')}>
      <span className="relative mt-0.5">
        {n.actor ? <Avatar name={n.actor.name} color={n.actor.color} avatarUrl={n.actor.avatarUrl} size={compact ? 32 : 36} /> : <NotificationGlyph type={n.type} size={compact ? 32 : 36} />}
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-[3px] focus-visible:after:ring-inset focus-visible:after:ring-ring/35">
          <span className={cn('block text-[15px] leading-snug', n.readAt ? 'text-foreground/80' : 'font-semibold text-foreground')}>{n.title}</span>
        </button>
        {n.body && <p className={cn('mt-0.5 text-sm text-muted-foreground', compact && 'line-clamp-2')}>{n.body}</p>}
        <p className="mt-1 text-xs text-faint">{timeAgo(n.occurredAt)}</p>
      </div>
      {!n.readAt && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
      {trailing && <div className="relative z-10 flex shrink-0 items-start gap-1">{trailing}</div>}
    </div>
  );
}

const NOTIFICATION_ICON: Record<string, typeof Bell> = {
  certificate_issued: Award,
  certificate_expiring: Award,
  certificate_revoked: Award,
  overdue: Bell,
  due_soon: Bell,
  nudge: Bell,
  session_reminder: CalendarDays,
  session_updated: CalendarDays,
  course_assigned: BookOpen,
  path_assigned: BookOpen,
};

function NotificationGlyph({ type, size }: { type: string; size: number }) {
  const Icon = NOTIFICATION_ICON[type] ?? Bell;
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full border bg-background', type === 'overdue' ? 'text-tone-danger' : 'text-muted-foreground')} style={{ width: size, height: size }} aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

// ── Account ───────────────────────────────────────────────────────────────

function AccountMenu() {
  const me = useMe();
  const { user } = useSession();
  const signOut = useSignOut();
  const person = me.data?.person;
  const displayName = person?.name || user?.email || 'You';
  const itemClass = 'h-10 gap-2.5 rounded-lg px-2.5 text-[15px]';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-11 items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-label={`Account menu for ${displayName}`}>
          <Avatar name={displayName} color={person?.color} avatarUrl={person?.avatarUrl} size={34} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <span className="block truncate text-[15px] font-medium">{displayName}</span>
          <span className="block truncate text-sm text-muted-foreground">{person?.email ?? user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className={itemClass}>
          <Link to="/profile">
            <UserRound className="h-4 w-4" /> Profile
          </Link>
        </DropdownMenuItem>
        {me.data?.features.leaderboard && (
          <DropdownMenuItem asChild className={itemClass}>
            <Link to="/leaderboard">
              <Trophy className="h-4 w-4" /> Leaderboard
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild className={itemClass}>
          <Link to="/notifications">
            <Bell className="h-4 w-4" /> Notifications
          </Link>
        </DropdownMenuItem>
        {me.data?.settings.adminAppUrl && (
          <DropdownMenuItem asChild className={itemClass}>
            <a href={me.data.settings.adminAppUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> Open admin app
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Light or dark follows your device settings.</p>
        <DropdownMenuItem onSelect={signOut} className={itemClass}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Phone tab bar ─────────────────────────────────────────────────────────

function BottomTabs() {
  const { items: all } = useNavItems();
  const items = all.filter(i => !i.desktopOnly);
  const me = useMe();
  const location = useLocation();
  const [more, setMore] = useState(false);
  const signOut = useSignOut();
  useEffect(() => setMore(false), [location.pathname]);

  // Four sections fit comfortably; the rest live under More.
  const primary = items.filter(i => i.to !== '/sessions' || items.length <= 4).slice(0, 4);
  const overflow = items.filter(i => !primary.includes(i));
  const moreLinks: Array<{ to: string; label: string; icon: typeof Home; external?: boolean }> = [
    ...overflow.map(i => ({ to: i.to, label: i.label, icon: i.icon })),
    ...(me.data?.isManager ? [{ to: '/team', label: 'My team', icon: Users }] : []),
    ...(me.data?.features.leaderboard ? [{ to: '/leaderboard', label: 'Leaderboard', icon: Trophy }] : []),
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/profile', label: 'Profile', icon: UserRound },
    ...(me.data?.settings.adminAppUrl ? [{ to: me.data.settings.adminAppUrl, label: 'Open admin app', icon: ExternalLink, external: true }] : []),
  ];
  const moreActive = moreLinks.some(l => !l.external && location.pathname.startsWith(l.to));

  const tabClass = (active: boolean) =>
    cn('relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35', active ? 'text-foreground' : 'text-muted-foreground');

  return (
    <nav aria-label="Sections" className="no-print fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto flex h-16 max-w-lg items-stretch">
        {primary.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => tabClass(item.match ? item.match(location.pathname) : isActive)}>
            {({ isActive }) => {
              const active = item.match ? item.match(location.pathname) : isActive;
              return (
                <>
                  <span className={cn('relative flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-primary/[0.1] text-primary')}>
                    <item.icon className="h-[21px] w-[21px]" aria-hidden strokeWidth={active ? 2.2 : 1.9} />
                    {item.badge ? <span className="absolute right-1.5 top-0 h-2.5 w-2.5 rounded-full bg-tone-danger ring-2 ring-background" aria-label={item.badgeLabel} /> : null}
                  </span>
                  <span className="max-w-full truncate px-0.5">{item.short}</span>
                </>
              );
            }}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} className={tabClass(moreActive)} aria-haspopup="dialog" aria-expanded={more}>
          <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-primary/[0.1] text-primary')}>
            <MoreHorizontal className="h-[21px] w-[21px]" aria-hidden />
          </span>
          More
        </button>
      </div>

      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border" aria-hidden />
          <div className="px-5 pb-1 pt-3">
            <SheetTitle className="font-serif text-lg font-semibold">More</SheetTitle>
          </div>
          <ul className="px-2 pb-2">
            {moreLinks.map(l => (
              <li key={l.to}>
                {l.external ? (
                  <a href={l.to} target="_blank" rel="noreferrer" className="flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium hover:bg-accent">
                    <l.icon className="h-5 w-5 text-muted-foreground" aria-hidden /> {l.label}
                  </a>
                ) : (
                  <Link to={l.to} className={cn('flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium hover:bg-accent', location.pathname.startsWith(l.to) && 'bg-accent')}>
                    <l.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{l.label}</span>
                    {l.to === '/notifications' && me.data?.counts.unreadNotifications ? <CountBadge count={me.data.counts.unreadNotifications} /> : null}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t p-3">
            <button type="button" onClick={signOut} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-base font-medium hover:bg-accent">
              <LogOut className="h-5 w-5 text-muted-foreground" aria-hidden /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────

function Footer() {
  const { data } = useAcademy();
  return (
    <footer className="no-print mt-16 border-t bg-background pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="font-serif text-[17px] font-semibold">{data?.organizationName ?? ' '}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{data?.academyName ? `${data.academyName} · ` : ''}Learning that fits around your work.</p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {data?.supportEmail && (
            <li>
              <a href={`mailto:${data.supportEmail}`} className="inline-flex items-center gap-1.5 rounded text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                <Mail className="h-4 w-4" aria-hidden /> {data.supportEmail}
              </a>
            </li>
          )}
        </ul>
      </div>
    </footer>
  );
}
