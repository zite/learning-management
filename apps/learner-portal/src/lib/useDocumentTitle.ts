import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Me } from './queries';

/** "Page · Academy", so a tab full of courses is still findable. */
export function useDocumentTitle(title: string | null | undefined) {
  const qc = useQueryClient();
  const academy = qc.getQueryData<Me>(['me'])?.settings.academyName;
  useEffect(() => {
    const suffix = academy || 'Academy';
    document.title = title ? `${title} · ${suffix}` : suffix;
  }, [title, academy]);
}
