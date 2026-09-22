import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Mail } from 'lucide-react';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@project/components/ui/tooltip';
import { Layout } from './components/Layout';
import { Button } from './components/ui';
import { useSession } from './lib/auth';
import { setCertificateTimeZone } from '@project/shared/certificateDates';
import { useBrand } from './lib/brand';
import { useAcademy, useMe } from './lib/queries';
import { initSystemTheme, useIsDark } from './lib/theme';

// Before the first render, so a dark-mode visitor never sees a white flash.
initSystemTheme();

/**
 * The learner app. HashRouter, not BrowserRouter: the app is served from a
 * path the runtime doesn't rewrite, so a refreshed path-based link — the kind
 * we email to learners — would 404.
 *
 * Everything needs a sign-in except certificate verification, which anyone
 * with the link (an employer, an auditor) can open.
 */

const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then(m => ({ default: m[name] })));

const HomePage = named(() => import('./pages/HomePage'), 'HomePage');
const MyLearningPage = named(() => import('./pages/MyLearningPage'), 'MyLearningPage');
const CatalogPage = named(() => import('./pages/CatalogPage'), 'CatalogPage');
const CourseOverviewPage = named(() => import('./pages/CourseOverviewPage'), 'CourseOverviewPage');
const PathPage = named(() => import('./pages/PathPage'), 'PathPage');
const CertificatesPage = named(() => import('./pages/CertificatesPage'), 'CertificatesPage');
const CertificatePage = named(() => import('./pages/CertificatePage'), 'CertificatePage');
const VerifyPage = named(() => import('./pages/VerifyPage'), 'VerifyPage');
const SessionsPage = named(() => import('./pages/SessionsPage'), 'SessionsPage');
const TeamPage = named(() => import('./pages/TeamPage'), 'TeamPage');
const LeaderboardPage = named(() => import('./pages/LeaderboardPage'), 'LeaderboardPage');
const ProfilePage = named(() => import('./pages/ProfilePage'), 'ProfilePage');
const NotificationsPage = named(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const PlayerPage = named(() => import('./pages/PlayerPage'), 'PlayerPage');

function Splash() {
  return (
    <div className="grid min-h-[100dvh] place-items-center" role="status" aria-label="Loading">
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-primary/70" style={{ animation: 'boot-slide 1.2s ease-in-out infinite' }} />
      </div>
      <style>{'@keyframes boot-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
    </div>
  );
}

const Page = ({ children }: { children: ReactNode }) => <Suspense fallback={<Splash />}>{children}</Suspense>;

function Mark({ size = 48 }: { size?: number }) {
  const { data } = useAcademy();
  if (data?.logoUrl) return <img src={data.logoUrl} alt="" className="object-contain" style={{ height: size }} />;
  return (
    <span className="inline-flex items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 64 64" style={{ width: size * 0.72, height: size * 0.72 }}>
        <path d="M25 17.5c0-3.9 3.1-7 7-7s7 3.1 7 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        <rect x="21" y="19" width="22" height="4.5" rx="2.25" fill="currentColor" />
        <path d="M23 24h18l-1.6 20.5a3 3 0 0 1-3 2.8h-8.8a3 3 0 0 1-3-2.8z" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
        <path d="M32 29.5c2.6 3 3.9 5.1 3.9 7.1a3.9 3.9 0 0 1-7.8 0c0-2 1.3-4.1 3.9-7.1z" fill="#fde68a" />
        <rect x="24" y="48.5" width="16" height="4" rx="2" fill="currentColor" />
      </svg>
    </span>
  );
}

function SignInScreen() {
  const { signIn } = useSession();
  const { data } = useAcademy();
  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden px-5 py-16">
      <div className="relative w-full max-w-md text-center animate-fade-up">
        <div className="flex justify-center">
          <Mark size={56} />
        </div>
        <p className="mt-6 text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">{data?.organizationName ?? ' '}</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">{data?.academyName ?? 'Academy'}</h1>
        <p className="mx-auto mt-3 max-w-sm text-[16px] text-muted-foreground">{data?.academyHeadline}</p>
        <Button size="lg" className="mt-8 w-full" onClick={() => signIn()}>
          Sign in to start learning
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          {data?.signInPolicy === 'Anyone' ? 'New here? Signing in creates your account.' : data?.signInPolicy === 'Allowed domains' ? 'Use your work email address.' : 'Use the email address your invitation was sent to.'}
        </p>
      </div>
    </main>
  );
}

function NoAccessScreen({ reason, email }: { reason: 'not_invited' | 'deactivated'; email: string | null }) {
  const { signOut } = useSession();
  const { data } = useAcademy();
  const qc = useQueryClient();
  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-16">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm animate-fade-up">
        <div className="flex justify-center">
          <Mark size={44} />
        </div>
        <h1 className="mt-5 font-serif text-2xl font-semibold">{reason === 'deactivated' ? 'Your access has ended' : "You're not on the list yet"}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {reason === 'deactivated'
            ? `The account for ${email ?? 'this email'} has been deactivated in ${data?.academyName ?? 'the academy'}.`
            : `${data?.academyName ?? 'This academy'} is invitation-only, and ${email ?? 'this email'} hasn't been added. If you think it should have, ask your administrator to invite you — or sign in with a different email.`}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {data?.supportEmail && (
            <a href={`mailto:${data.supportEmail}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border bg-background px-4 text-[15px] font-medium hover:bg-accent">
              <Mail className="h-4 w-4" /> Contact {data.supportEmail}
            </a>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              qc.removeQueries({ predicate: q => q.queryKey[0] !== 'academy' });
              signOut();
            }}
          >
            <LogOut /> Sign in with a different email
          </Button>
        </div>
      </div>
    </main>
  );
}

function Gate() {
  const { user, isLoading } = useSession();
  const me = useMe();
  if (isLoading) return <Splash />;
  if (!user) return <SignInScreen />;
  if (me.isPending) return <Splash />;
  if (me.isError || !me.data) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="max-w-sm text-center">
          <h1 className="font-serif text-2xl font-semibold">We couldn't load your learning</h1>
          <p className="mt-2 text-muted-foreground">Check your connection and try again.</p>
          <Button className="mt-5" onClick={() => me.refetch()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }
  if (me.data.access !== 'ok') return <NoAccessScreen reason={me.data.access} email={me.data.email} />;

  const f = me.data.features;
  return (
    <Routes>
      {/* The course player is a focused, full-screen space of its own. */}
      <Route path="/learn/:slug" element={<Page><PlayerPage /></Page>} />
      <Route path="/learn/:slug/:lessonId" element={<Page><PlayerPage /></Page>} />
      <Route
        path="*"
        element={
          <Layout>
            <Page>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/learning" element={<MyLearningPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/courses/:slug" element={<CourseOverviewPage />} />
                <Route path="/paths/:slug" element={<PathPage />} />
                <Route path="/certificates" element={<CertificatesPage />} />
                <Route path="/certificates/:id" element={<CertificatePage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/team" element={me.data.isManager ? <TeamPage /> : <Navigate to="/" replace />} />
                <Route path="/leaderboard" element={f.leaderboard ? <LeaderboardPage /> : <Navigate to="/" replace />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Page>
          </Layout>
        }
      />
    </Routes>
  );
}

function Branded({ children }: { children: ReactNode }) {
  const { data } = useAcademy();
  useBrand(data?.brandColor);
  // Certificates are dated in the organization's zone; set before any certificate renders.
  setCertificateTimeZone(data?.timezone);
  return <>{children}</>;
}

export default function App() {
  const dark = useIsDark();
  return (
    <TooltipProvider delayDuration={250}>
      <HashRouter>
        <Branded>
          <Routes>
            <Route path="/verify/:credentialId" element={<Page><VerifyPage /></Page>} />
            <Route path="/verify" element={<Page><VerifyPage /></Page>} />
            <Route path="*" element={<Gate />} />
          </Routes>
        </Branded>
      </HashRouter>
      <Toaster position="bottom-center" theme={dark ? 'dark' : 'light'} closeButton toastOptions={{ className: 'text-[15px] rounded-xl' }} />
    </TooltipProvider>
  );
}
