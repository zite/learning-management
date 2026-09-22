import { useCallback, useEffect, useState } from 'react';
import { usePeopleSearch } from '../../lib/queries';
import type { PersonLite } from '../../lib/types';

/**
 * Names for picked person ids: everyone a picker has shown, plus a lookup for
 * ids picked earlier. `remember` is stable and only changes state when it
 * learns someone new — PersonPicker calls it from an effect, so a fresh
 * callback or Map on every render would loop forever.
 */
export function useKnownPeople(ids: string[], enabled: boolean) {
  const [known, setKnown] = useState<Map<string, PersonLite>>(() => new Map());
  const remember = useCallback((people: PersonLite[]) => {
    setKnown(prev => {
      if (people.every(p => prev.get(p.id) === p)) return prev;
      const next = new Map(prev);
      for (const p of people) next.set(p.id, p);
      return next;
    });
  }, []);
  const missing = ids.filter(id => !known.has(id));
  const { data } = usePeopleSearch('', { ids: missing, enabled: enabled && missing.length > 0 });
  useEffect(() => {
    if (data) remember(data.people);
  }, [data, remember]);
  return { known, remember };
}
