import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { MOD } from '../../lib/hotkeys';
import { Kbd } from '../primitives/bits';

export const GO_KEYS: Array<{ key: string; to: string; label: string }> = [
  { key: 'h', to: '/home', label: 'Home' },
  { key: 'i', to: '/inbox', label: 'Inbox' },
  { key: 'a', to: '/grading', label: 'Grading' },
  { key: 'q', to: '/discussions', label: 'Discussions' },
  { key: 'c', to: '/courses', label: 'Courses' },
  { key: 'l', to: '/paths', label: 'Learning paths' },
  { key: 's', to: '/sessions', label: 'Live sessions' },
  { key: 'p', to: '/people', label: 'People' },
  { key: 't', to: '/groups', label: 'Groups' },
  { key: 'e', to: '/enrollments', label: 'Enrollments' },
  { key: 'u', to: '/assignments', label: 'Assignment rules' },
  { key: 'x', to: '/certificates', label: 'Certificates' },
  { key: 'r', to: '/reports', label: 'Reports' },
  { key: ',', to: '/settings', label: 'Settings' },
];

const GROUPS: Array<{ title: string; items: Array<{ label: string; keys: string[]; then?: boolean }> }> = [
  {
    title: 'General',
    items: [
      { label: 'Command menu', keys: [MOD, 'K'] },
      { label: 'Create…', keys: ['C'] },
      { label: 'Enroll people…', keys: ['⇧', 'E'] },
      { label: 'Search in current list', keys: ['/'] },
      { label: 'Keyboard shortcuts', keys: ['?'] },
      { label: 'Toggle sidebar', keys: ['['] },
      { label: 'Toggle theme', keys: [MOD, '⇧', 'L'] },
    ],
  },
  { title: 'Navigation', items: GO_KEYS.map(g => ({ label: g.label, keys: ['G', g.key === ',' ? ',' : g.key.toUpperCase()], then: true })) },
  {
    title: 'Lists',
    items: [
      { label: 'Move focus', keys: ['J', 'K'] },
      { label: 'Select / deselect', keys: ['X'] },
      { label: 'Extend selection', keys: ['⇧', 'J'] },
      { label: 'Select all', keys: [MOD, 'A'] },
      { label: 'Open', keys: ['↵'] },
      { label: 'Peek enrollment', keys: ['Space'] },
      { label: 'Clear selection', keys: ['Esc'] },
    ],
  },
  {
    title: 'Enrollments',
    items: [
      { label: 'Change due date', keys: ['D'] },
      { label: 'Send reminder', keys: ['R'] },
      { label: 'Mark complete', keys: ['⇧', 'C'] },
      { label: 'Withdraw', keys: ['⇧', 'W'] },
      { label: 'Open learner', keys: ['P'] },
      { label: 'Open course', keys: ['O'] },
    ],
  },
  {
    title: 'Course builder',
    items: [
      { label: 'Add a lesson', keys: ['A'] },
      { label: 'Next / previous lesson', keys: ['↓', '↑'] },
      { label: 'Move lesson down / up', keys: ['⌥', '↓', '↑'] },
      { label: 'Save now', keys: [MOD, 'S'] },
      { label: 'Preview as a learner', keys: [MOD, '⇧', 'P'] },
    ],
  },
  {
    title: 'Grading',
    items: [
      { label: 'Next / previous submission', keys: ['J', 'K'] },
      { label: 'Pass', keys: [MOD, '↵'] },
      { label: 'Needs revision', keys: [MOD, '⇧', '↵'] },
      { label: 'Focus feedback', keys: ['F'] },
    ],
  },
  {
    title: 'Inbox',
    items: [
      { label: 'Next / previous notification', keys: ['J', 'K'] },
      { label: 'Open notification', keys: ['↵'] },
      { label: 'Archive', keys: ['E'] },
      { label: 'Archive everything read', keys: ['⇧', 'E'] },
      { label: 'Mark read / unread', keys: ['U'] },
    ],
  },
  {
    title: 'Rules & sessions',
    items: [
      { label: 'New rule or session', keys: ['N'] },
      { label: 'Toggle agenda / month', keys: ['M'] },
      { label: 'Mark attended', keys: ['A'] },
      { label: 'Mark absent', keys: ['B'] },
    ],
  },
  {
    title: 'Discussions',
    items: [
      { label: 'Next / previous thread', keys: ['J', 'K'] },
      { label: 'Reply', keys: ['R'] },
      { label: 'Send reply', keys: [MOD, '↵'] },
      { label: 'Search threads', keys: ['/'] },
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 sm:rounded-xl">
        <DialogHeader className="border-b px-5 pb-3 pt-4">
          <DialogTitle className="text-[16px]">Keyboard shortcuts</DialogTitle>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search shortcuts…" className="mt-2 h-9 rounded-md border border-input bg-transparent px-2.5 text-[14px] outline-none focus:border-foreground/30" />
        </DialogHeader>
        <div className="grid max-h-[62vh] gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {GROUPS.map(g => {
            const items = g.items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()));
            if (!items.length) return null;
            return (
              <div key={g.title}>
                <div className="mb-1.5 text-sm font-medium text-muted-foreground">{g.title}</div>
                {items.map(i => (
                  <div key={i.label} className="flex h-9 items-center justify-between border-b border-border/50 text-[14px] last:border-0">
                    <span>{i.label}</span>
                    <span className="flex items-center gap-1">
                      {i.keys.map((k, n) => (
                        <span key={n} className="flex items-center gap-1">
                          {i.then && n > 0 && <span className="text-2xs text-muted-foreground">then</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
