import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Tip } from '../ui';

export type FilterOption = { value: string; label: string };

/**
 * A filter that reads like a button and opens a menu of choices. Unset, it
 * shows its name ("Level"); set, it shows the choice ("Beginner") in ink so an
 * active filter is obvious at a glance. Radix gives it arrow keys, typeahead,
 * Escape and focus return.
 */
export function FilterMenu({
  name,
  anyLabel,
  value,
  options,
  onChange,
  disabledReason,
  className,
}: {
  name: string;
  anyLabel: string;
  value: string | null;
  options: FilterOption[];
  onChange: (value: string | null) => void;
  /** When set, the filter doesn't apply right now; the reason shows on hover. */
  disabledReason?: string | null;
  className?: string;
}) {
  const selected = options.find(o => o.value === value) ?? null;
  const disabled = Boolean(disabledReason);
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={selected ? `${name}: ${selected.label}` : `${name}: ${anyLabel}`}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border pl-3.5 pr-2.5 text-sm font-medium shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 data-[state=open]:bg-accent sm:h-12 sm:text-[15px]',
        selected ? 'border-foreground/70 bg-background text-foreground' : 'border-input bg-background text-foreground/85 hover:border-foreground/25 hover:bg-accent',
        disabled && 'cursor-not-allowed text-muted-foreground opacity-60 hover:border-input hover:bg-background',
        className,
      )}
    >
      {selected ? selected.label : name}
      <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
    </button>
  );

  if (disabled) {
    // A disabled button swallows pointer events, so the tooltip hangs off a wrapper.
    return (
      <Tip label={disabledReason}>
        <span className="inline-flex" tabIndex={0} aria-label={`${name} filter: ${disabledReason}`}>
          {trigger}
        </span>
      </Tip>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[13rem] rounded-xl p-1.5">
        <DropdownMenuRadioGroup value={value ?? ''} onValueChange={v => onChange(v || null)}>
          <Item value="" label={anyLabel} checked={!selected} />
          <DropdownMenuSeparator className="mx-0" />
          {options.map(o => (
            <Item key={o.value} value={o.value} label={o.label} checked={selected?.value === o.value} />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({ value, label, checked }: { value: string; label: string; checked: boolean }) {
  return (
    <MenuPrimitive.RadioItem
      value={value}
      className={cn(
        'relative flex h-10 cursor-default select-none items-center gap-3 rounded-lg pl-2.5 pr-9 text-[15px] outline-none transition-colors focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        checked && 'font-medium',
      )}
    >
      {label}
      <MenuPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
        <Check className="h-4 w-4" aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}
