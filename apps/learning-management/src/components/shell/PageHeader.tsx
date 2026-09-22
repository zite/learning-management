import { PanelLeft } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { NavLink, useOutletContext } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { IconButton, Tip } from '../primitives/bits';

type ShellContext = { toggleSidebar: () => void; sidebarCollapsed: boolean } | undefined;

export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Learning Management` : 'Learning Management';
  }, [title]);
}

/** `active` overrides path matching, for tabs that live in the query string (`?tab=`). */
export type HeaderTab = { to: string; label: string; count?: number | null; end?: boolean; active?: boolean };

/**
 * The top bar every page shares: where you are, the page's own tabs, and its
 * actions on the right. Kept to one 44px row so lists start high on the screen;
 * on phones the tabs drop to a second row rather than squeezing the title.
 */
export function PageHeader({ icon, title, tabs, actions, children, className, breadcrumb }: {
  icon?: ReactNode;
  title: ReactNode;
  /** A parent link shown before the title, like "Programs ›". */
  breadcrumb?: { to: string; label: string } | null;
  tabs?: HeaderTab[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const shell = useOutletContext<ShellContext>();
  return (
    <header className={cn('flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 border-b px-3 sm:h-11 sm:flex-nowrap', className)}>
      {shell?.sidebarCollapsed && (
        <Tip label="Show sidebar" keys={['[']}>
          <IconButton onClick={shell.toggleSidebar} aria-label="Show sidebar" className="hidden md:inline-flex">
            <PanelLeft />
          </IconButton>
        </Tip>
      )}
      <div className="flex h-11 min-w-0 items-center gap-2 pl-1 sm:h-auto">
        {breadcrumb && (
          <>
            <NavLink to={breadcrumb.to} className="hidden shrink-0 text-[14.5px] text-muted-foreground hover:text-foreground sm:inline">{breadcrumb.label}</NavLink>
            <span className="hidden text-muted-foreground/60 sm:inline">›</span>
          </>
        )}
        {icon && <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
        <h1 className="truncate text-[14.5px] font-medium">{title}</h1>
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="-mx-1 order-last flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-0.5 overflow-x-auto px-1 pb-2 scrollbar-none sm:order-none sm:mx-0 sm:ml-2 sm:w-auto sm:px-0 sm:pb-0" aria-label="Sections">
          {tabs.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive: pathActive }) => {
                const isActive = t.active ?? pathActive;
                return cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors',
                  isActive ? 'border-border bg-accent font-medium text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                );
              }}
            >
              {t.label}
              {t.count != null && t.count > 0 && <span className="tabular-nums text-muted-foreground">{t.count}</span>}
            </NavLink>
          ))}
        </nav>
      )}
      {/* Custom header content (usually query-string tabs) gets its own row on phones; from sm up the wrapper disappears. */}
      {children && <div className="order-last -mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center overflow-x-auto px-1 pb-2 scrollbar-none sm:contents">{children}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
