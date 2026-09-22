import { useEffect, useRef } from 'react';

/**
 * ⌘↵ (Ctrl+Enter) runs `fn` while `active` — listened for on the window, so it
 * still works when focus has fallen out of the dialog (say, onto a button that
 * just became disabled).
 */
export function useModEnter(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
