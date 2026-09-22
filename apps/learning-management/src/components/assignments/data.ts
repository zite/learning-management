import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { listRules, previewRule, runRule, saveRule, sendReminders, type ListRulesOutputType, type PreviewRuleInputType, type SaveRuleInputType, type SendRemindersOutputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshEverythingSoon } from '../../lib/mutations';
import { qk } from '../../lib/queries';

export type RuleRow = ListRulesOutputType['rules'][number];
export type RuleStatus = RuleRow['status'];
export type RuleConfig = {
  name: string;
  targetType: 'Course' | 'Path';
  courseId: string | null;
  pathId: string | null;
  audience: 'Everyone' | 'Groups' | 'People';
  groupIds: string[];
  personIds: string[];
  dueMode: 'None' | 'Relative' | 'Fixed';
  dueDays: number | null;
  dueDate: string | null;
  recurrenceMonths: number | null;
  includeFutureMembers: boolean;
  sendEmail: boolean;
};

export const ruleKeys = {
  list: [...qk.rulesRoot, 'list'] as const,
  preview: (c: PreviewRuleInputType) => [...qk.rulesRoot, 'preview', c] as const,
};

export function useRules() {
  return useQuery({ queryKey: ruleKeys.list, queryFn: () => listRules({}), staleTime: 20_000 });
}

/** Only what the server can preview; empty groups/people still preview as zero. */
export function previewInput(c: RuleConfig): PreviewRuleInputType {
  return {
    name: c.name,
    targetType: c.targetType,
    courseId: c.targetType === 'Course' ? c.courseId : null,
    pathId: c.targetType === 'Path' ? c.pathId : null,
    audience: c.audience,
    groupIds: c.audience === 'Groups' ? c.groupIds : [],
    personIds: c.audience === 'People' ? c.personIds : [],
    dueMode: c.dueMode,
    dueDays: c.dueMode === 'Relative' ? c.dueDays : null,
    dueDate: c.dueMode === 'Fixed' ? c.dueDate : null,
    recurrenceMonths: c.recurrenceMonths,
    includeFutureMembers: c.includeFutureMembers,
    sendEmail: c.sendEmail,
  };
}

export function useRulePreview(input: PreviewRuleInputType | null) {
  return useQuery({
    queryKey: ruleKeys.preview(input ?? ({} as PreviewRuleInputType)),
    queryFn: () => previewRule(input!),
    enabled: Boolean(input),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

export const configFromRule = (r: RuleRow): RuleConfig => ({
  name: r.name,
  targetType: r.targetType,
  courseId: r.courseId,
  pathId: r.pathId,
  audience: r.audience,
  groupIds: r.groupIds,
  personIds: r.personIds,
  dueMode: r.dueMode,
  dueDays: r.dueDays,
  dueDate: r.dueDate,
  recurrenceMonths: r.recurrenceMonths,
  includeFutureMembers: r.includeFutureMembers,
  sendEmail: r.sendEmail,
});

export const recurrenceText = (months: number | null | undefined) => (!months ? null : months === 12 ? 'every year' : months === 24 ? 'every 2 years' : months % 12 === 0 ? `every ${months / 12} years` : `every ${months} month${months === 1 ? '' : 's'}`);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type Applied = { created: number; reactivated: number; skipped: number; skippedInactive: number; audience: number } | null;

export function appliedSummary(a: Applied) {
  if (!a) return undefined;
  const enrolled = a.created + a.reactivated;
  const parts = [enrolled ? `Enrolled ${plural(enrolled, 'person', 'people')}` : 'Nobody new to enroll'];
  if (a.skipped) parts.push(`${a.skipped} already enrolled or finished`);
  if (a.skippedInactive) parts.push(`${a.skippedInactive} deactivated`);
  return parts.join(' · ');
}

export function useRuleActions() {
  const qc = useQueryClient();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.rulesRoot });
    refreshEverythingSoon(qc, 300);
  }, [qc]);

  /** Status changes show immediately; the server's answer (and any enrollments) follow. */
  const setStatusOptimistic = useCallback(
    (id: string, status: RuleStatus | null) => {
      const snap = qc.getQueryData<ListRulesOutputType>(ruleKeys.list);
      if (snap) qc.setQueryData<ListRulesOutputType>(ruleKeys.list, { ...snap, rules: status ? snap.rules.map(r => (r.id === id ? { ...r, status } : r)) : snap.rules.filter(r => r.id !== id) });
      return () => snap && qc.setQueryData(ruleKeys.list, snap);
    },
    [qc],
  );

  const save = useCallback(
    async (input: SaveRuleInputType, label: string, opts: { success?: string; description?: string } = {}) => {
      const optimistic = input.id && input.action !== 'update' && input.action !== 'create' ? setStatusOptimistic(input.id, input.action === 'pause' ? 'Paused' : input.action === 'resume' ? 'Active' : input.action === 'archive' ? 'Archived' : null) : null;
      const toastId = input.action === 'create' || input.action === 'resume' || input.apply ? toast.loading(label) : undefined;
      try {
        const res = await saveRule(input);
        const message = { create: res.status === 'Active' ? 'Rule created and run' : 'Rule saved, paused', update: 'Rule updated', pause: 'Rule paused', resume: 'Rule resumed', archive: 'Rule archived', delete: 'Rule deleted' }[input.action];
        toast.success(opts.success ?? message, { id: toastId, description: opts.description ?? appliedSummary(res.applied) ?? (input.action === 'pause' ? 'Nobody new is enrolled until you resume it.' : input.action === 'archive' ? 'It stops running. Enrollments it created stay.' : undefined) });
        refresh();
        return res;
      } catch (e) {
        optimistic?.();
        toast.error(errorMessage(e, "Couldn't save the rule"), { id: toastId });
        throw e;
      }
    },
    [refresh, setStatusOptimistic],
  );

  const run = useCallback(
    async (rule: Pick<RuleRow, 'id' | 'name'>) => {
      const toastId = toast.loading(`Running “${rule.name}”…`);
      try {
        const res = await runRule({ id: rule.id });
        toast.success(res.created + res.reactivated ? `Enrolled ${plural(res.created + res.reactivated, 'person', 'people')}` : 'Everyone is already enrolled', { id: toastId, description: `${plural(res.audience, 'person', 'people')} in the audience${res.skipped ? ` · ${res.skipped} skipped` : ''}` });
        refresh();
        return res;
      } catch (e) {
        toast.error(errorMessage(e, "Couldn't run the rule"), { id: toastId });
        return null;
      }
    },
    [refresh],
  );

  const runReminders = useCallback(async () => {
    const toastId = toast.loading('Sending reminders…');
    try {
      const res: SendRemindersOutputType = await sendReminders({});
      const parts = [
        res.dueSoon && `${res.dueSoon} due soon`,
        res.overdue && `${res.overdue} overdue`,
        res.managerDigests && plural(res.managerDigests, 'manager digest'),
        res.recertified && `${res.recertified} recertified`,
        res.expiringCertificates && plural(res.expiringCertificates, 'expiring certificate'),
        res.sessionReminders && plural(res.sessionReminders, 'session reminder'),
      ].filter(Boolean);
      toast.success(parts.length ? 'Reminders sent' : 'Nothing to send right now', { id: toastId, description: parts.length ? parts.join(' · ') : 'Everyone has been reminded recently. Reminders also go out every day at 14:00 UTC.' });
      if (res.recertified) refreshEverythingSoon(qc, 200);
      return res;
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't send reminders"), { id: toastId });
      return null;
    }
  }, [qc]);

  return useMemo(() => ({ save, run, runReminders }), [save, run, runReminders]);
}
