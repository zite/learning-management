/**
 * Unsaved-changes guard for navigation that doesn't go through a link: G-key
 * shortcuts and the ⌘K palette. Forms register while they have unsaved edits;
 * links are caught separately by the form's own guard (see settings/ui.tsx).
 */

const unsaved = new Set<symbol>();

export const LEAVE_CONFIRM = { title: 'Leave without saving?', description: 'You have changes on this page that haven’t been saved. If you leave, they’re discarded.', confirmLabel: 'Discard changes', destructive: true } as const;

/** Mark this form as having unsaved edits; returns the function that clears it. */
export function holdUnsaved() {
  const token = Symbol('unsaved');
  unsaved.add(token);
  return () => {
    unsaved.delete(token);
  };
}

export const hasUnsavedChanges = () => unsaved.size > 0;

/** Navigate now, or after the person agrees to discard their edits. */
export function guardedNavigate(navigate: (to: string) => void, confirm: (o: typeof LEAVE_CONFIRM) => Promise<boolean>, to: string) {
  if (!hasUnsavedChanges()) return navigate(to);
  void confirm(LEAVE_CONFIRM).then(ok => ok && navigate(to));
}
