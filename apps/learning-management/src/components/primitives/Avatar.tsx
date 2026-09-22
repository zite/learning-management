import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { initials } from '../../lib/format';
import type { PersonLike } from '../../lib/types';

type AvatarProps = {
  name?: string | null;
  src?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
};

export function Avatar({ name, src, color, size = 20, className, ring }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) };
  if (src && !failed) {
    return <img src={src} alt="" onError={() => setFailed(true)} className={cn('shrink-0 rounded-full object-cover', ring && 'ring-2 ring-background', className)} style={style} />;
  }
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none text-white', ring && 'ring-2 ring-background', className)} style={{ ...style, background: color || '#8b8d98' }}>
      {initials(name)}
    </span>
  );
}

/** A person from any source — a staff member from bootstrap, a list row, a search result. */
export function PersonAvatar({ person, size = 20, className, ring }: { person: PersonLike | null | undefined; size?: number; className?: string; ring?: boolean }) {
  if (!person) return <UnassignedAvatar size={size} className={className} />;
  return <Avatar name={person.name} src={person.avatarUrl} color={person.color} size={size} className={cn(person.status === 'Deactivated' && 'opacity-50 grayscale', className)} ring={ring} />;
}

export function UnassignedAvatar({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground', className)} style={{ width: size, height: size }}>
      <UserRound style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={2} />
    </span>
  );
}

export function AvatarStack({ people, size = 20, max = 4 }: { people: Array<PersonLike | undefined | null>; size?: number; max?: number }) {
  const all = people.filter(Boolean) as PersonLike[];
  const shown = all.slice(0, max);
  const extra = all.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p, i) => (
        <PersonAvatar key={p.id ?? i} person={p} size={size} ring />
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
