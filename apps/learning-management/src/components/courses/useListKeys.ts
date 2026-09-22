import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { hasOpenOverlay as hasOverlayOpen, useHotkeys } from '../../lib/hotkeys';

/**
 * Focus and selection for a keyboard-first list: J/K (or arrows) move, X
 * toggles, Shift+J/K extend, ⌘A selects all, Esc clears, Enter opens. Rows
 * mark themselves with `data-row-id` so focus can scroll them into view.
 */
export function useListKeys({ ids, onOpen, scrollRef, enabled = true, extra = {} }: { ids: string[]; onOpen: (id: string) => void; scrollRef: RefObject<HTMLElement | null>; enabled?: boolean; extra?: Record<string, (focusedId: string | null) => void> }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const idSet = useMemo(() => new Set(ids), [ids]);

  // Rows that left the list (filtered, archived, deleted) drop out of the selection.
  useEffect(() => {
    setSelection(prev => {
      const next = new Set([...prev].filter(id => idSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setFocusedId(f => (f && !idSet.has(f) ? null : f));
  }, [idSet]);

  const scrollTo = (id: string) => window.setTimeout(() => scrollRef.current?.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  const index = focusedId ? ids.indexOf(focusedId) : -1;
  const focusAt = (i: number, extend = false) => {
    const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
    if (!id) return;
    if (extend) setSelection(prev => new Set(prev).add(id).add(focusedId ?? id));
    setFocusedId(id);
    scrollTo(id);
  };

  const toggle = useCallback(
    (id: string, e?: { shiftKey?: boolean }) => {
      setSelection(prev => {
        const next = new Set(prev);
        if (e?.shiftKey && anchor.current && ids.includes(anchor.current)) {
          const a = ids.indexOf(anchor.current);
          const b = ids.indexOf(id);
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) next.add(ids[n]);
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
      setFocusedId(id);
    },
    [ids],
  );

  /** Row click: modifier keys (or an active selection) select; a plain click opens. */
  const onRowClick = (id: string, e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"], input')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || selection.size > 0) {
      e.preventDefault();
      toggle(id, e);
      return;
    }
    onOpen(id);
  };

  const extraBindings = Object.fromEntries(Object.entries(extra).map(([k, fn]) => [k, () => fn(focusedId)]));
  useHotkeys(
    {
      j: () => focusAt(index + 1),
      down: () => focusAt(index + 1),
      k: () => focusAt(index < 0 ? 0 : index - 1),
      up: () => focusAt(index < 0 ? 0 : index - 1),
      'shift+j': () => focusAt(index + 1, true),
      'shift+down': () => focusAt(index + 1, true),
      'shift+k': () => focusAt(index - 1, true),
      'shift+up': () => focusAt(index - 1, true),
      x: () => focusedId && toggle(focusedId),
      'mod+a': () => setSelection(new Set(ids)),
      esc: () => (selection.size ? setSelection(new Set()) : setFocusedId(null)),
      o: () => focusedId && onOpen(focusedId),
      ...extraBindings,
    },
    { enabled },
  );

  // Enter opens the focused row — but never steals Enter from a focused button, link or field elsewhere.
  const openRef = useRef(() => undefined as void);
  openRef.current = () => {
    if (focusedId) onOpen(focusedId);
  };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && !(scrollRef.current?.contains(a) && a.hasAttribute('data-row-id'))) return;
      if (hasOverlayOpen()) return;
      e.preventDefault();
      openRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, scrollRef]);

  return { focusedId, setFocusedId, selection, setSelection, toggle, onRowClick, clear: () => setSelection(new Set()) };
}

/** A boolean or string preference kept in localStorage. */
export function useStoredState<T extends string | boolean>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return (typeof initial === 'boolean' ? raw === '1' : raw) as T;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
      } catch {
        /* storage may be unavailable */
      }
    },
    [key],
  );
  return [value, set] as const;
}
