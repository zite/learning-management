import type { BootstrapOutputType, GetCourseOutputType, ListEnrollmentsInputType, ListEnrollmentsOutputType, SearchPeopleOutputType } from 'zitejs/api';

/**
 * Client types, all derived from endpoint outputs so the UI can never drift
 * from what the server actually sends. Feature areas add their own aliases
 * next to the endpoints they use.
 */

export type Bootstrap = BootstrapOutputType;
export type Me = Bootstrap['me'];
export type Settings = Bootstrap['settings'];
export type StaffMember = Bootstrap['staff'][number];
export type Group = Bootstrap['groups'][number];
export type Category = Bootstrap['categories'][number];
export type Course = Bootstrap['courses'][number];
export type Path = Bootstrap['paths'][number];
export type EmailTemplate = Bootstrap['templates'][number];
export type SavedView = Bootstrap['views'][number];
export type Counts = Course['counts'];

export type CourseDetail = GetCourseOutputType;
export type CourseLesson = CourseDetail['lessons'][number];
export type CourseSection = CourseDetail['sections'][number];

export type EnrollmentList = ListEnrollmentsOutputType;
export type Enrollment = EnrollmentList['rows'][number];
export type EnrollmentFilters = NonNullable<ListEnrollmentsInputType['filters']>;
export type EnrollmentOrdering = NonNullable<ListEnrollmentsInputType['ordering']>;
export type EnrollmentStatus = Enrollment['status'];
export type DueState = Enrollment['dueState'];

export type PersonLite = SearchPeopleOutputType['people'][number];

/** Anything with the shape of a person, for avatars. */
export type PersonLike = { id?: string; name: string; color?: string | null; avatarUrl?: string | null; status?: string | null };

export type LessonType = CourseLesson['type'];
