import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getLesson, getPlayer, listLessonComments, type GetLessonOutputType, type GetPlayerOutputType, type ListLessonCommentsOutputType, type SubmitQuizOutputType } from 'zitejs/api';
import { retry } from '../../lib/queries';

export type Player = GetPlayerOutputType;
export type PlayerLesson = Player['lessons'][number];
export type LessonData = GetLessonOutputType;
export type QuizData = NonNullable<LessonData['quiz']>;
export type QuizReview = NonNullable<SubmitQuizOutputType['review']>;
export type AssignmentData = NonNullable<LessonData['assignment']>;
export type LiveData = NonNullable<LessonData['live']>;
export type SessionItem = LiveData['sessions'][number];
export type Thread = ListLessonCommentsOutputType['threads'][number];
export type CertificateInfo = NonNullable<Player['certificate']>;

/** What a finished lesson (or passed quiz) reports back. */
export type CompletionResult = { progress: number; status: string; completedNow: boolean; certificateId: string | null; certificate: CertificateInfo | null; nextLessonId: string | null };

/** Keys live under the player's reserved roots: ['player'], ['lesson'], ['comments']. */
export const playerKeys = {
  player: (slug: string) => ['player', slug] as const,
  lesson: (slug: string, lessonId: string) => ['lesson', slug, lessonId] as const,
  comments: (lessonId: string) => ['comments', lessonId] as const,
};

export function usePlayer(slug: string) {
  return useQuery({ queryKey: playerKeys.player(slug), queryFn: () => getPlayer({ slug }), retry, staleTime: 20_000, enabled: Boolean(slug) });
}

export function useLesson(slug: string, lessonId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: playerKeys.lesson(slug, lessonId ?? ''), queryFn: () => getLesson({ slug, lessonId: lessonId! }), retry, staleTime: 20_000, enabled: Boolean(lessonId) && enabled });
}

export function useComments(lessonId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: playerKeys.comments(lessonId ?? ''), queryFn: () => listLessonComments({ lessonId: lessonId! }), retry, staleTime: 15_000, enabled: Boolean(lessonId) && enabled });
}

/** Progress moved: everything that shows it elsewhere in the app refreshes. */
export function refreshProgressEverywhere(qc: QueryClient, slug: string) {
  void qc.invalidateQueries({ queryKey: playerKeys.player(slug) });
  for (const root of ['me', 'home', 'learning', 'course', 'path', 'certificates']) void qc.invalidateQueries({ queryKey: [root] });
}

/** Reflect a completion in the cached outline straight away, before the refetch lands. */
export function patchPlayerCompletion(qc: QueryClient, slug: string, lessonId: string, result: Pick<CompletionResult, 'progress' | 'status' | 'certificateId' | 'certificate'>) {
  qc.setQueryData<Player>(playerKeys.player(slug), prev => {
    if (!prev || !prev.enrollment) return prev;
    let lessons = prev.lessons.map(l => (l.id === lessonId ? { ...l, state: 'completed' as const } : l));
    // Finishing a lesson in a sequential course may open the next one; unlock (never lock) until the refetch confirms.
    if (prev.course.sequential && !prev.pathLock) {
      let blocked = false;
      lessons = lessons.map(l => {
        const next = l.state === 'locked' && !blocked ? { ...l, state: 'available' as const } : l;
        if (!l.optional && l.state !== 'completed') blocked = true;
        return next;
      });
    }
    return {
      ...prev,
      lessons,
      enrollment: { ...prev.enrollment, progress: result.progress, status: result.status, certificateId: result.certificateId ?? prev.enrollment.certificateId },
      certificate: result.certificate ?? prev.certificate,
    };
  });
  qc.setQueryData<LessonData>(playerKeys.lesson(slug, lessonId), prev => (prev ? { ...prev, state: 'completed' } : prev));
}
