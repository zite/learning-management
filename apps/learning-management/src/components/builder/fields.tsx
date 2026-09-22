import { Loader2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { Button } from '@project/components/ui/button';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { inputClass } from './ui';

/**
 * A link box that only commits addresses that can be saved. Typing "youtu"
 * on the way to a full link never reaches the server (which would reject it);
 * the hint appears once you stop typing something that isn't a link.
 */
export function UrlField({ id, value, onCommit, placeholder, requireHttps, readOnly, ariaLabel, className }: {
  id?: string;
  value: string | null;
  onCommit: (url: string | null) => void;
  placeholder?: string;
  requireHttps?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [text, setText] = useState(value ?? '');
  const [touched, setTouched] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ?? '');
  }, [value]);
  const t = text.trim();
  const pattern = requireHttps ? /^https:\/\/[^\s/]+\.[^\s]+$/i : /^https?:\/\/[^\s/]+\.[^\s]+$/i;
  const valid = !t || pattern.test(t);
  const showError = !valid && touched;
  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <input
        id={id}
        type="url"
        inputMode="url"
        aria-label={ariaLabel}
        aria-invalid={showError || undefined}
        readOnly={readOnly}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        className={inputClass}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setTouched(true);
        }}
        onChange={e => {
          const next = e.target.value;
          setText(next);
          const nt = next.trim();
          if (!nt) onCommit(null);
          else if (pattern.test(nt)) {
            setTouched(false);
            onCommit(nt);
          }
        }}
      />
      {showError && (
        <p role="alert" className="mt-1 text-sm text-tone-danger">
          {requireHttps && /^http:\/\//i.test(t) ? 'Embedded pages need a secure address that starts with https://' : 'Paste a full link that starts with https://'}
        </p>
      )}
    </div>
  );
}

/** Upload through Zite's storage, with a size check first and a clear busy state. */
export function UploadButton({ accept, onUploaded, children, maxMb = 200, variant = 'outline', className, disabled }: {
  accept: string;
  onUploaded: (file: { url: string; name: string }) => void;
  children: ReactNode;
  maxMb?: number;
  variant?: 'outline' | 'default' | 'ghost';
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`${file.name} is larger than ${maxMb} MB. Upload a smaller file, or link to it instead.`);
      return;
    }
    setBusy(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      onUploaded({ url: fileUrl, name: file.name });
    } catch (e) {
      toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="button" variant={variant} size="sm" disabled={busy || disabled} className={cn('h-9 shrink-0 gap-1.5 text-[13.5px]', className)} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="!h-3.5 !w-3.5 animate-spin" /> : <Upload className="!h-3.5 !w-3.5" />}
        {busy ? 'Uploading…' : children}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void pick(f);
        }}
      />
    </>
  );
}

/** A big drop target for the first upload. */
export function DropZone({ accept, onUploaded, title, hint, maxMb = 200 }: { accept: string; onUploaded: (file: { url: string; name: string }) => void; title: string; hint: string; maxMb?: number }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`${file.name} is larger than ${maxMb} MB. Upload a smaller file, or link to it instead.`);
      return;
    }
    setBusy(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      onUploaded({ url: fileUrl, name: file.name });
    } catch (e) {
      toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03]',
          over && 'border-primary bg-primary/[0.05]',
        )}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-2xs">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </span>
        <span className="text-[14px] font-medium">{busy ? 'Uploading…' : title}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void take(f);
        }}
      />
    </>
  );
}
