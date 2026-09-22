import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { LESSON_TYPE_META, LESSON_TYPES, type LessonType } from '@project/shared/lessons';
import { LessonTypeIcon } from '../primitives/icons';

/** The eight kinds of lesson, each with what it's for. Number keys pick one while the menu is open. */
export function AddLessonMenu({ open, onOpenChange, onPick, children, align = 'start', side = 'bottom', label = 'Add a lesson', extra }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPick: (type: LessonType) => void;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'bottom' | 'right' | 'left';
  label?: string;
  extra?: ReactNode;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        className="w-[300px] p-1"
        onKeyDown={e => {
          const n = Number(e.key);
          if (Number.isInteger(n) && n >= 1 && n <= LESSON_TYPES.length && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onOpenChange?.(false);
            onPick(LESSON_TYPES[n - 1]);
          }
        }}
      >
        <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{label}</DropdownMenuLabel>
        {LESSON_TYPES.map((type, i) => (
          <DropdownMenuItem key={type} onSelect={() => onPick(type)} className="items-start gap-2.5 rounded-md px-2 py-1.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-background shadow-2xs">
              <LessonTypeIcon type={type} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-5">{LESSON_TYPE_META[type].label}</span>
              <span className="block text-2xs leading-4 text-muted-foreground">{LESSON_TYPE_META[type].description}</span>
            </span>
            <span className="kbd mt-0.5 shrink-0">{i + 1}</span>
          </DropdownMenuItem>
        ))}
        {extra && (
          <>
            <DropdownMenuSeparator />
            {extra}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
