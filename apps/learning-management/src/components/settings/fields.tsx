import { ChevronsUpDown, Globe2, ImageUp, Loader2, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { Button } from '@project/components/ui/button';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { FALLBACK_TIMEZONES } from './constants';

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

function allTimezones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try {
    const list = supported ? supported('timeZone') : [];
    return list.length ? (list.includes('UTC') ? list : [...list, 'UTC']) : FALLBACK_TIMEZONES;
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

/** "GMT-5" / "GMT+5:30" for a zone, right now. */
export function zoneOffset(timeZone: string, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName');
    return part?.value === 'GMT' ? 'GMT+0' : part?.value ?? '';
  } catch {
    return '';
  }
}

export function zoneTime(timeZone: string, at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  } catch {
    return '';
  }
}

const offsetMinutes = (label: string) => {
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
};

export const zoneLabel = (tz: string) => tz.replace(/_/g, ' ').replace(/\//g, ' / ');

export function TimezonePicker({ value, onChange, id }: { value: string; onChange: (tz: string) => void; id?: string }) {
  const [open, setOpen] = useState(false);
  const options = useMemo<Option<string>[]>(() => {
    const now = new Date();
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return allTimezones()
      .map(tz => ({ tz, offset: zoneOffset(tz, now) }))
      .sort((a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset) || a.tz.localeCompare(b.tz))
      .map(({ tz, offset }) => ({
        value: tz,
        label: zoneLabel(tz),
        keywords: [tz, offset, ...tz.split('/').map(p => p.replace(/_/g, ' '))],
        hint: offset,
        group: tz === browser ? 'Your browser' : undefined,
      }))
      .sort((a, b) => (a.group ? -1 : b.group ? 1 : 0));
  }, [open]);
  return (
    <OptionPicker
      open={open}
      onOpenChange={setOpen}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Search cities or GMT offsets…"
      width={320}
      align="end"
      emptyText="No time zone matches"
      trigger={
        <button id={id} type="button" className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-[14px] shadow-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{zoneLabel(value)}</span>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{zoneOffset(value)}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Image upload (logo, avatar)
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Pick an image, upload it, hand back its URL. Only https URLs are kept —
 * emails and the certificate PDF can't load anything else.
 */
export function useImageUpload(onUploaded: (url: string) => Promise<unknown>) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pick = () => input.current?.click();
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|svg\+xml|webp|gif)$/.test(file.type)) {
      toast.error('Choose a PNG, JPG, SVG or WebP image');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('That image is over 4 MB — try a smaller version');
      return;
    }
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      if (!/^https:\/\//.test(fileUrl)) throw new Error('The upload didn’t return a secure link');
      await onUploaded(fileUrl);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't upload that image"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };
  const inputEl = <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" className="hidden" onChange={e => void onFile(e.target.files?.[0])} />;
  return { pick, uploading, inputEl };
}

/** A logo on a light and a dark tile, so a dark-on-transparent logo that vanishes in dark mode is obvious before learners see it. */
export function LogoTiles({ url, fallback, onBroken }: { url: string | null; fallback: ReactNode; onBroken?: () => void }) {
  const [broken, setBroken] = useState<string | null>(null);
  const show = url && broken !== url;
  const tile = (tone: 'light' | 'dark') => (
    <div
      className={cn('flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border px-3', tone === 'light' ? 'border-black/10 bg-[#fdfcf9]' : 'border-white/10 bg-[#1b1a18]')}
      title={tone === 'light' ? 'On a light background' : 'On a dark background'}
    >
      {show ? (
        <img
          src={url}
          alt={tone === 'light' ? 'Logo on a light background' : 'Logo on a dark background'}
          className="max-h-9 max-w-full object-contain"
          onError={() => {
            setBroken(url);
            onBroken?.();
          }}
        />
      ) : (
        <span className={cn('text-[18px] font-semibold', tone === 'light' ? 'text-[#57534e]' : 'text-[#d6d3d1]')}>{fallback}</span>
      )}
    </div>
  );
  return (
    <div className="flex gap-2">
      {tile('light')}
      {tile('dark')}
    </div>
  );
}

export function UploadButtons({ hasImage, uploading, removing, onPick, onRemove, label = 'Upload' }: { hasImage: boolean; uploading: boolean; removing?: boolean; onPick: () => void; onRemove: () => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="button" size="sm" variant="outline" disabled={uploading || removing} onClick={onPick}>
        {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />} {hasImage ? 'Replace' : label}
      </Button>
      {hasImage && (
        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={uploading || removing} onClick={onRemove}>
          {removing ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
        </Button>
      )}
    </div>
  );
}
