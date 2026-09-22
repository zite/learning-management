import { Award, BellRing, ChevronRight, Database, FolderTree, GraduationCap, Settings, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@project/components/ui/select';
import { cn } from '@project/components/lib/utils';
import { AcademySettings } from '../components/settings/AcademySettings';
import { CategoriesSettings } from '../components/settings/CategoriesSettings';
import { CertificateSettings } from '../components/settings/CertificateSettings';
import { DataSettings } from '../components/settings/DataSettings';
import { GeneralSettings } from '../components/settings/GeneralSettings';
import { NotificationSettings } from '../components/settings/NotificationSettings';
import { ProfileSettings } from '../components/settings/ProfileSettings';
import { hasUnsavedSettings, LEAVE_CONFIRM } from '../components/settings/ui';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { useWorkspace } from '../lib/workspace';

type Section = 'general' | 'academy' | 'data' | 'categories' | 'notifications' | 'certificates' | 'profile';
type Group = 'Organization' | 'Learning' | 'Account';

const SECTIONS: Record<Section, { label: string; icon: LucideIcon; group: Group }> = {
  general: { label: 'General', icon: SlidersHorizontal, group: 'Organization' },
  academy: { label: 'Academy', icon: GraduationCap, group: 'Organization' },
  data: { label: 'Data', icon: Database, group: 'Organization' },
  categories: { label: 'Categories', icon: FolderTree, group: 'Learning' },
  notifications: { label: 'Notifications', icon: BellRing, group: 'Learning' },
  certificates: { label: 'Certificates', icon: Award, group: 'Learning' },
  profile: { label: 'Profile', icon: UserRound, group: 'Account' },
};

const GROUPS: Array<{ label: Group; sections: Section[] }> = [
  { label: 'Organization', sections: ['general', 'academy', 'data'] },
  { label: 'Learning', sections: ['categories', 'notifications', 'certificates'] },
  { label: 'Account', sections: ['profile'] },
];

function NavItem({ section, badge }: { section: Section; badge?: boolean }) {
  const s = SECTIONS[section];
  return (
    <NavLink
      to={`/settings/${section}`}
      className={({ isActive }) =>
        cn('flex h-8 items-center gap-2 rounded-md px-2 text-[14px] transition-colors duration-75', isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')
      }
    >
      <s.icon className="h-[15px] w-[15px] shrink-0" />
      <span className="truncate">{s.label}</span>
      {badge && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-tone-warning" aria-label="Demo data is still here" />}
    </NavLink>
  );
}

export function SettingsPage() {
  const { section: raw = '' } = useParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const location = useLocation();
  const scroller = useRef<HTMLDivElement>(null);
  const available: Section[] = ws.isAdmin ? GROUPS.flatMap(g => g.sections) : ['profile'];
  const section = (available as string[]).includes(raw) ? (raw as Section) : null;
  useDocumentTitle(section ? `${SECTIONS[section].label} · Settings` : 'Settings');

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Unknown sections land on General; instructors only have Profile.
  if (!section) return <Navigate to={ws.isAdmin ? '/settings/general' : '/settings/profile'} replace />;

  const content =
    section === 'general' ? <GeneralSettings />
    : section === 'academy' ? <AcademySettings />
    : section === 'data' ? <DataSettings />
    : section === 'categories' ? <CategoriesSettings />
    : section === 'notifications' ? <NotificationSettings />
    : section === 'certificates' ? <CertificateSettings />
    : <ProfileSettings />;

  const groups = GROUPS.map(g => ({ ...g, sections: g.sections.filter(s => available.includes(s)) })).filter(g => g.sections.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Settings />}
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-muted-foreground">Settings</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{SECTIONS[section].label}</span>
          </span>
        }
      />
      <div className="flex min-h-0 flex-1">
        {available.length > 1 && (
          <nav aria-label="Settings" className="hidden w-[220px] shrink-0 overflow-y-auto border-r bg-subtle px-2 py-5 lg:block">
            {groups.map(g => (
              <div key={g.label} className="mb-5">
                <div className="mb-1 px-2 text-sm font-medium text-muted-foreground">{g.label}</div>
                <div className="space-y-px">
                  {g.sections.map(s => <NavItem key={s} section={s} badge={s === 'data' && Boolean(ws.demo)} />)}
                </div>
              </div>
            ))}
          </nav>
        )}
        <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
          {available.length > 1 && (
            <div className="sticky top-0 z-10 border-b bg-subtle/95 px-4 py-2 backdrop-blur lg:hidden">
              <Select
                value={section}
                onValueChange={async v => {
                  if (hasUnsavedSettings() && !(await app.confirm(LEAVE_CONFIRM))) return;
                  navigate(`/settings/${v}`);
                }}
              >
                <SelectTrigger aria-label="Settings section" className="h-9 bg-background text-[14px] [&>span]:flex [&>span]:items-center [&>span]:gap-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g, i) => (
                    <SelectGroup key={g.label}>
                      {i > 0 && <SelectSeparator />}
                      <SelectLabel className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{g.label}</SelectLabel>
                      {g.sections.map(s => {
                        const Icon = SECTIONS[s].icon;
                        return (
                          <SelectItem key={s} value={s} className="text-[14px]">
                            <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-muted-foreground" /> {SECTIONS[s].label}</span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* One content width for every section, so the title and cards never jump as you move between them. */}
          <div key={section} className="mx-auto w-full max-w-[840px] px-4 pb-20 pt-6 animate-fade-in sm:px-8 lg:pt-10">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}
