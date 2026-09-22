import {
  Bold, Code, Columns2, Eye, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo, Loader2, Minus, PenLine, SquareCode, Strikethrough, Table, TextQuote,
} from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { Tip } from '../primitives/bits';
import { readingMinutes } from './model';
import { AutoTextarea, Segmented } from './ui';

type Mode = 'write' | 'split' | 'preview';
type Kind = 'h2' | 'h3' | 'ul' | 'ol' | 'task' | 'quote';

const BLOCK_PREFIX = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;
const MODE_KEY = 'lms:builder:markdown-mode';

function storedMode(): Mode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'write' || v === 'split' || v === 'preview' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Markdown, written the way people write documents: a formatting bar and the
 * shortcuts from every editor (⌘B, ⌘I, ⌘K), lists that continue on Enter,
 * images uploaded by button, paste or drop — and a live preview rendered by the
 * same component the learner app uses, so what you see is what learners get.
 *
 * Edits go through the browser's own text insertion, so ⌘Z undoes a
 * formatting action like it undoes typing. Markdown is stored as-is: tables,
 * task lists and anything else GitHub-flavoured survive untouched.
 */
export function MarkdownField({ id, value, onChange, readOnly, placeholder, variant = 'notes', label, minRows = 5, emptyPreview = 'Nothing written yet.' }: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** `article` is the lesson itself: bigger type, the full toolbar, split preview on wide screens. */
  variant?: 'article' | 'notes';
  label?: ReactNode;
  minRows?: number;
  emptyPreview?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [wide, setWide] = useState(false);
  const [mode, setModeState] = useState<Mode>(() => (variant === 'article' ? storedMode() ?? 'split' : 'write'));
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const article = variant === 'article';

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 700));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setMode = (m: Mode) => {
    setModeState(m);
    if (article) {
      try {
        localStorage.setItem(MODE_KEY, m);
      } catch {
        /* private mode */
      }
    }
  };
  // Split needs room; on a narrow column it quietly behaves like Write.
  const effective: Mode = mode === 'split' && !wide ? 'write' : mode;

  // ── Text operations ──────────────────────────────────────────────────────
  const replace = (start: number, end: number, text: string, selStart: number, selEnd: number) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = start === end && !text ? true : document.execCommand(text ? 'insertText' : 'delete', false, text);
    } catch {
      ok = false;
    }
    if (!ok) onChange(el.value.slice(0, start) + text + el.value.slice(end));
    const select = () => {
      try {
        el.setSelectionRange(selStart, selEnd);
      } catch {
        /* detached */
      }
    };
    select();
    window.setTimeout(select, 0);
  };

  const wrap = (before: string, after: string, placeholderText: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const selected = v.slice(s, e);
    if (selected && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replace(s - before.length, e + after.length, selected, s - before.length, e - before.length);
      return;
    }
    const inner = selected || placeholderText;
    replace(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
  };

  const prefixLines = (kind: Kind) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, value: v } = el;
    let e = el.selectionEnd;
    if (e > s && v[e - 1] === '\n') e -= 1;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = v.indexOf('\n', e);
    if (lineEnd === -1) lineEnd = v.length;
    const lines = v.slice(lineStart, lineEnd).split('\n');
    const want = (i: number) => ({ h2: '## ', h3: '### ', ul: '- ', ol: `${i + 1}. `, task: '- [ ] ', quote: '> ' })[kind];
    const has = (l: string) =>
      kind === 'ol' ? /^\d+[.)] /.test(l) : kind === 'ul' ? /^[-*+] (?!\[[ xX]\] )/.test(l) : kind === 'task' ? /^[-*+] \[[ xX]\] /.test(l) : l.startsWith(want(0));
    const filled = lines.filter(l => l.trim());
    const allHave = filled.length > 0 && filled.every(has);
    let n = 0;
    const next = lines
      .map(l => {
        if (!l.trim() && lines.length > 1) return l;
        const stripped = l.replace(BLOCK_PREFIX, '');
        return allHave ? stripped : want(n++) + stripped;
      })
      .join('\n');
    const collapsed = s === el.selectionEnd;
    replace(lineStart, lineEnd, next, collapsed ? lineStart + next.length : lineStart, lineStart + next.length);
  };

  const insertBlock = (text: string, select?: [number, number]) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const before = v.slice(0, s);
    const after = v.slice(e);
    const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const base = s + lead.length;
    replace(s, e, lead + text + trail, base + (select ? select[0] : text.length), base + (select ? select[1] : text.length) + (select ? 0 : trail.length));
  };

  const codeBlock = () => {
    const el = ref.current;
    if (!el) return;
    const selected = el.value.slice(el.selectionStart, el.selectionEnd);
    if (selected) insertBlock(`\`\`\`\n${selected}\n\`\`\``, [4, 4 + selected.length]);
    else insertBlock('```\n\n```', [4, 4]);
  };

  const link = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const selected = v.slice(s, e);
    if (/^https?:\/\/\S+$/.test(selected)) {
      replace(s, e, `[link text](${selected})`, s + 1, s + 10);
      return;
    }
    const text = selected || 'link text';
    const insert = `[${text}](https://)`;
    // Select the URL to type over when there's already text; the text when there isn't.
    if (selected) replace(s, e, insert, s + text.length + 3, s + text.length + 11);
    else replace(s, e, insert, s + 1, s + 1 + text.length);
  };

  const upload = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (!images.length) {
      if (files.length) toast.error('Only images can go into the text. Use a File lesson for documents.');
      return;
    }
    const el = ref.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length];
    setUploading(n => n + images.length);
    try {
      const parts: string[] = [];
      for (const file of images) {
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name} is over 20 MB. Use a smaller image.`);
          continue;
        }
        const { fileUrl } = await uploadFile({ data: file, filename: file.name });
        const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '').slice(0, 80);
        parts.push(`![${alt}](${fileUrl})`);
      }
      if (parts.length && ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(at[0], at[1]);
        insertBlock(parts.join('\n\n'));
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t upload that image'));
    } finally {
      setUploading(n => Math.max(0, n - images.length));
    }
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey) {
      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (!e.shiftKey && k === 'b') return run(() => wrap('**', '**', 'bold text'));
      if (!e.shiftKey && k === 'i') return run(() => wrap('_', '_', 'emphasis'));
      if (!e.shiftKey && k === 'k') return run(link);
      if (!e.shiftKey && k === 'e') return run(() => wrap('`', '`', 'code'));
      if (e.shiftKey && k === 'x') return run(() => wrap('~~', '~~', 'text'));
      if (e.shiftKey && (e.code === 'Digit8' || k === '*')) return run(() => prefixLines('ul'));
      if (e.shiftKey && (e.code === 'Digit7' || k === '&')) return run(() => prefixLines('ol'));
      if (e.shiftKey && (e.code === 'Digit9' || k === '(')) return run(() => prefixLines('task'));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && el.selectionStart === el.selectionEnd) {
      const v = el.value;
      const s = el.selectionStart;
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      let lineEnd = v.indexOf('\n', s);
      if (lineEnd === -1) lineEnd = v.length;
      const line = v.slice(lineStart, s);
      const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )/);
      if (!m) return;
      e.preventDefault();
      const content = v.slice(lineStart + m[0].length, lineEnd);
      if (!content.trim() && s === lineEnd) {
        // Enter on an empty item ends the list, with the blank line Markdown needs after it.
        replace(lineStart, lineEnd, '\n', lineStart + 1, lineStart + 1);
        return;
      }
      let marker = m[2];
      if (m[3]) marker = `${Number(m[3]) + 1}${m[4]} `;
      marker = marker.replace(/\[[xX]\]/, '[ ]');
      const insert = `\n${m[1]}${marker}`;
      replace(s, s, insert, s + insert.length, s + insert.length);
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const v = el.value;
      const s = el.selectionStart;
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(lineStart, v.indexOf('\n', s) === -1 ? v.length : v.indexOf('\n', s));
      if (!/^\s*([-*+] |\d+[.)] )/.test(line)) return; // Tab leaves the field, unless you're in a list.
      e.preventDefault();
      if (e.shiftKey) {
        const remove = line.match(/^ {1,2}/)?.[0].length ?? 0;
        if (remove) replace(lineStart, lineStart + remove, '', Math.max(lineStart, s - remove), Math.max(lineStart, el.selectionEnd - remove));
      } else {
        replace(lineStart, lineStart, '  ', s + 2, el.selectionEnd + 2);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.some(f => f.type.startsWith('image/'))) {
      e.preventDefault();
      void upload(files);
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const el = e.currentTarget;
    const selected = el.value.slice(el.selectionStart, el.selectionEnd);
    // Pasting a link over selected words makes it a link.
    if (selected && !selected.includes('\n') && /^https?:\/\/\S+$/.test(text.trim())) {
      e.preventDefault();
      const s = el.selectionStart;
      const insert = `[${selected}](${text.trim()})`;
      replace(s, el.selectionEnd, insert, s + insert.length, s + insert.length);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length || readOnly) return;
    e.preventDefault();
    void upload(files);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const { words, minutes } = readingMinutes(value);
  // Rendering Markdown on every keystroke of a long article would lag the typing; the preview can trail by a frame.
  const previewValue = useDeferredValue(value);

  if (readOnly) {
    return (
      <div className={cn('rounded-xl border bg-card px-5 py-4', !article && 'px-4 py-3')}>
        {label && <div className="mb-2 text-sm font-medium text-muted-foreground">{label}</div>}
        {value.trim() ? <Markdown className={article ? 'text-[15.5px]' : undefined}>{value}</Markdown> : <p className="text-[14px] text-muted-foreground">{emptyPreview}</p>}
      </div>
    );
  }

  type Action = { key: string; label: string; icon: ReactNode; keys?: string[]; run: () => void; article?: boolean };
  const actions: Array<Action | 'sep'> = [
    { key: 'h2', label: 'Heading', icon: <Heading2 />, run: () => prefixLines('h2') },
    { key: 'h3', label: 'Subheading', icon: <Heading3 />, run: () => prefixLines('h3'), article: true },
    'sep',
    { key: 'bold', label: 'Bold', icon: <Bold />, keys: [MOD, 'B'], run: () => wrap('**', '**', 'bold text') },
    { key: 'italic', label: 'Italic', icon: <Italic />, keys: [MOD, 'I'], run: () => wrap('_', '_', 'emphasis') },
    { key: 'strike', label: 'Strikethrough', icon: <Strikethrough />, keys: [MOD, '⇧', 'X'], run: () => wrap('~~', '~~', 'text'), article: true },
    { key: 'code', label: 'Inline code', icon: <Code />, keys: [MOD, 'E'], run: () => wrap('`', '`', 'code'), article: true },
    { key: 'link', label: 'Link', icon: <Link2 />, keys: [MOD, 'K'], run: link },
    'sep',
    { key: 'ul', label: 'Bulleted list', icon: <List />, keys: [MOD, '⇧', '8'], run: () => prefixLines('ul') },
    { key: 'ol', label: 'Numbered list', icon: <ListOrdered />, keys: [MOD, '⇧', '7'], run: () => prefixLines('ol') },
    { key: 'task', label: 'Checklist', icon: <ListTodo />, keys: [MOD, '⇧', '9'], run: () => prefixLines('task'), article: true },
    { key: 'quote', label: 'Quote or callout', icon: <TextQuote />, run: () => prefixLines('quote'), article: true },
    { key: 'codeblock', label: 'Code block', icon: <SquareCode />, run: codeBlock, article: true },
    { key: 'table', label: 'Table', icon: <Table />, run: () => insertBlock('| Column | Column |\n| --- | --- |\n| Cell | Cell |', [2, 8]), article: true },
    { key: 'hr', label: 'Divider', icon: <Minus />, run: () => insertBlock('---'), article: true },
    'sep',
    { key: 'image', label: 'Upload an image', icon: uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />, run: () => fileRef.current?.click() },
  ];
  const visibleActions = actions.filter(a => a === 'sep' || article || !a.article);

  const modeOptions = article && wide
    ? [
        { value: 'write', label: '', icon: <PenLine />, tip: 'Write' },
        { value: 'split', label: '', icon: <Columns2 />, tip: 'Write with a live preview' },
        { value: 'preview', label: '', icon: <Eye />, tip: 'Preview' },
      ]
    : [
        { value: 'write', label: 'Write' },
        { value: 'preview', label: 'Preview' },
      ];

  const textarea = (
    <AutoTextarea
      id={id}
      ref={ref}
      value={value}
      minRows={minRows}
      placeholder={placeholder}
      spellCheck
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={cn(
        'block w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground/70',
        article ? 'min-h-[320px] px-5 py-4 text-[15.5px] leading-7' : 'px-3 py-2.5 text-[14px] leading-relaxed',
      )}
    />
  );

  const preview = (
    <div className={cn('min-w-0', article ? 'px-5 py-4' : 'px-3 py-2.5')}>
      {previewValue.trim() ? <Markdown className={article ? 'text-[15.5px]' : 'text-[14px]'}>{previewValue}</Markdown> : <p className="text-[14px] text-muted-foreground">{emptyPreview}</p>}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      onDragOver={e => {
        if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'relative rounded-xl border bg-card shadow-2xs transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-primary/10',
        dragOver && 'border-primary ring-[3px] ring-primary/15',
      )}
    >
      {label && <div className="border-b px-3 pb-2 pt-2.5 text-sm font-medium text-muted-foreground">{label}</div>}
      <div className={cn('flex items-center gap-0.5 border-b px-1.5', article ? 'sticky top-0 z-10 h-10 rounded-t-xl bg-card/95 backdrop-blur' : 'h-9')}>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
          {visibleActions.map((a, i) =>
            a === 'sep' ? (
              <span key={`sep-${i}`} className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
            ) : (
              <Tip key={a.key} label={a.label} keys={a.keys}>
                <button
                  type="button"
                  aria-label={a.label}
                  disabled={effective === 'preview' || (a.key === 'image' && uploading > 0)}
                  onMouseDown={e => e.preventDefault()}
                  onClick={a.run}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5"
                >
                  {a.icon}
                </button>
              </Tip>
            ),
          )}
        </div>
        <Segmented size="sm" value={effective} onChange={v => setMode(v as Mode)} options={modeOptions} ariaLabel="Editor view" className="ml-1" />
      </div>

      {effective === 'split' ? (
        <div className="grid grid-cols-2 divide-x">
          <div className="min-w-0">{textarea}</div>
          <div className="min-w-0 bg-subtle/40">{preview}</div>
        </div>
      ) : effective === 'preview' ? (
        preview
      ) : (
        textarea
      )}

      <div className="flex h-9 items-center justify-between gap-2 border-t px-3 text-2xs text-muted-foreground">
        <span className="tabular-nums">
          {uploading > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading {uploading === 1 ? 'image' : `${uploading} images`}…
            </span>
          ) : words ? (
            `${words.toLocaleString()} word${words === 1 ? '' : 's'}${article ? ` · about ${minutes} min read` : ''}`
          ) : (
            'Markdown supported'
          )}
        </span>
        <span className="hidden sm:inline">Drop or paste images to add them</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void upload(files);
        }}
      />
    </div>
  );
}
