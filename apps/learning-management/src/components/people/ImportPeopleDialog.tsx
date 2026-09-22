import { ArrowLeft, CheckCircle2, CircleAlert, Download, FileSpreadsheet, FileUp, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { importPeople, type ImportPeopleOutputType } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@project/components/ui/select';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { downloadText } from '../../lib/download';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { Kbd } from '../primitives/bits';
import { autoMap, IMPORT_FIELDS, parseCsv, TEMPLATE_CSV, type ImportField, type ParsedCsv } from './csv';
import { peopleCount, refreshPeople, toCsv } from './peopleData';

/**
 * Import people from a spreadsheet in four steps: choose a file, match its
 * columns, review exactly what will happen row by row (a dry run on the
 * server, so the preview is the real logic), then import.
 */

const MAX_ROWS = 2000;
const NONE = '__none';
type Step = 'file' | 'map' | 'review' | 'done';
type Result = ImportPeopleOutputType;
type Filter = 'all' | 'create' | 'update' | 'skip';

export function ImportPeopleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<ImportField, number | null>>(autoMap([]));
  const [createMissingGroups, setCreateMissingGroups] = useState(true);
  const [sendInvites, setSendInvites] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'import'>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep('file');
    setFileName('');
    setCsv(null);
    setFileError(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setFilter('all');
    setSendInvites(false);
    setCreateMissingGroups(true);
  }, [open]);

  const readFile = async (file: File | undefined | null) => {
    if (!file) return;
    setFileError(null);
    if (!/\.(csv|tsv|txt)$/i.test(file.name) && !/csv|text/.test(file.type)) {
      setFileError('Choose a .csv file. In Excel or Google Sheets, use File → Download → CSV.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError('That file is over 5 MB. Split it into smaller files.');
      return;
    }
    const parsed = parseCsv(await file.text());
    if (!parsed.headers.length || !parsed.rows.length) {
      setFileError('That file has no rows under its header. The first row should name the columns.');
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setFileError(`That file has ${parsed.rows.length.toLocaleString()} rows. Import up to ${MAX_ROWS.toLocaleString()} at a time — split it and import the rest after.`);
      return;
    }
    setFileName(file.name);
    setCsv(parsed);
    setMapping(autoMap(parsed.headers));
    setStep('map');
  };

  const rowsForServer = useMemo(() => {
    if (!csv) return [];
    const at = (row: string[], key: ImportField) => (mapping[key] == null ? null : row[mapping[key]!] ?? null);
    return csv.rows.map(row => ({ email: at(row, 'email'), name: at(row, 'name'), title: at(row, 'title'), managerEmail: at(row, 'managerEmail'), groups: at(row, 'groups'), hireDate: at(row, 'hireDate'), externalId: at(row, 'externalId'), role: at(row, 'role') }));
  }, [csv, mapping]);

  const runPreview = async (opts: { createMissingGroups: boolean } = { createMissingGroups }) => {
    setBusy('preview');
    setError(null);
    try {
      const res = await importPeople({ rows: rowsForServer, createMissingGroups: opts.createMissingGroups, sendInvites, dryRun: true });
      setPreview(res);
      setStep('review');
    } catch (e) {
      setError(errorMessage(e, "Couldn't check that file"));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!preview || busy) return;
    setBusy('import');
    setError(null);
    try {
      const res = await importPeople({ rows: rowsForServer, createMissingGroups, sendInvites, dryRun: false });
      setResult(res);
      setStep('done');
      refreshPeople(qc);
    } catch (e) {
      setError(errorMessage(e, "Couldn't import those people"));
    } finally {
      setBusy(null);
    }
  };

  const toImport = preview ? preview.totals.create + preview.totals.update : 0;
  const shown = (preview?.rows ?? []).filter(r => filter === 'all' || r.action === filter);

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent
        className={cn('flex max-h-[92dvh] flex-col gap-0 p-0 sm:rounded-xl', step === 'review' ? 'max-w-[900px]' : 'max-w-[600px]')}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (step === 'map' && mapping.email != null) void runPreview();
            if (step === 'review' && toImport) void runImport();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 pb-3.5 pt-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> Import people
            <span className="ml-2 hidden items-center gap-1 text-sm font-normal text-muted-foreground sm:flex">
              {(['file', 'map', 'review', 'done'] as const).map((s, i) => (
                <span key={s} className={cn('flex items-center gap-1', step === s && 'font-medium text-foreground')}>
                  {i > 0 && <span className="text-muted-foreground/50">›</span>}
                  {{ file: 'File', map: 'Columns', review: 'Review', done: 'Done' }[s]}
                </span>
              ))}
            </span>
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            {step === 'file' && 'Add new people and update existing ones, matched by email. Blank cells never erase what’s already here.'}
            {step === 'map' && `${fileName} · ${peopleCount(csv?.rows.length ?? 0).replace('people', 'rows').replace('person', 'row')}. Match your columns to the fields below.`}
            {step === 'review' && 'Nothing has been saved yet. This is exactly what the import will do.'}
            {step === 'done' && 'The import finished.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 'file' && (
            <div className="space-y-3 px-5 py-5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={e => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragging(false);
                  void readFile(e.dataTransfer.files?.[0]);
                }}
                className={cn('flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors', dragging ? 'border-primary bg-primary/[0.05]' : 'hover:border-foreground/30 hover:bg-accent/40')}
              >
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border bg-subtle text-muted-foreground">
                  <FileUp className="h-4 w-4" />
                </span>
                <span className="text-[14.5px] font-medium">Drop a CSV file here, or choose one</span>
                <span className="mt-1 text-sm text-muted-foreground">Up to {MAX_ROWS.toLocaleString()} people · a header row naming the columns</span>
              </button>
              <input ref={inputRef} type="file" accept=".csv,text/csv,.tsv,.txt" className="hidden" onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} />
              {fileError && (
                <p className="flex items-start gap-2 rounded-lg border border-tone-danger/30 bg-tone-danger/[0.06] px-3 py-2 text-[14px] text-tone-danger">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {fileError}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-subtle/60 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">Columns: name, email, title, manager email, groups (separated by ;), hire date, employee ID, role.</span>
                <button type="button" onClick={() => downloadText('lms-people-template.csv', TEMPLATE_CSV)} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
                  <Download className="h-3.5 w-3.5" /> Template
                </button>
              </div>
            </div>
          )}

          {step === 'map' && csv && (
            <div className="px-5 py-4">
              <div className="overflow-hidden rounded-lg border">
                {IMPORT_FIELDS.map((f, i) => {
                  const idx = mapping[f.key];
                  const sample = idx != null ? csv.rows.map(r => r[idx]).find(v => v) : null;
                  return (
                    <div key={f.key} className={cn('grid grid-cols-1 items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)]', i > 0 && 'border-t')}>
                      <div>
                        <div className="text-[14px] font-medium">
                          {f.label}
                          {f.required && <span className="ml-1 text-tone-danger">*</span>}
                        </div>
                        {f.hint && <div className="text-2xs text-muted-foreground">{f.hint}</div>}
                      </div>
                      <Select value={idx == null ? NONE : String(idx)} onValueChange={v => setMapping(m => ({ ...m, [f.key]: v === NONE ? null : Number(v) }))}>
                        <SelectTrigger aria-label={`Column for ${f.label}`} className={cn('h-9 w-full rounded-md border-input bg-background px-2.5 text-[14px] shadow-2xs focus:ring-2 focus:ring-ring/20 focus:ring-offset-0 [&>span]:truncate', idx == null && 'text-muted-foreground')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value={NONE} className="text-[14px] text-muted-foreground">
                            {f.required ? 'Choose a column…' : 'Don’t import'}
                          </SelectItem>
                          {csv.headers.map((h, hi) => (
                            <SelectItem key={hi} value={String(hi)} className="text-[14px]">
                              {h || `Column ${hi + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="truncate text-sm text-muted-foreground" title={sample ?? undefined}>
                        {sample ? <>e.g. <span className="text-foreground/80">{sample}</span></> : idx != null ? 'Empty in this file' : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
              {mapping.email == null && <p className="mt-2 text-sm text-tone-danger">Choose the column with email addresses — it’s how people are matched.</p>}
              {error && <p className="mt-2 text-[14px] text-tone-danger">{error}</p>}
            </div>
          )}

          {step === 'review' && preview && (
            <div className="px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
                  <Switch
                    checked={createMissingGroups}
                    onCheckedChange={v => {
                      setCreateMissingGroups(v);
                      void runPreview({ createMissingGroups: v });
                    }}
                    className="mt-0.5"
                    disabled={Boolean(busy)}
                  />
                  <span>
                    <span className="block text-[14px] font-medium">Create missing groups</span>
                    <span className="block text-sm text-muted-foreground">{preview.totals.groupsToCreate.length ? `Creates ${preview.totals.groupsToCreate.map(g => `“${g}”`).join(', ')}` : 'Otherwise rows naming unknown groups are skipped'}</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
                  <Switch checked={sendInvites} onCheckedChange={setSendInvites} className="mt-0.5" disabled={Boolean(busy)} />
                  <span>
                    <span className="block text-[14px] font-medium">Send invitations to new people</span>
                    <span className="block text-sm text-muted-foreground">{sendInvites ? `Emails ${peopleCount(preview.totals.create)} a link to sign in` : 'Add them quietly — invite later from People'}</span>
                  </span>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {([
                  ['all', 'All', preview.rows.length, 'text-muted-foreground'],
                  ['create', 'New', preview.totals.create, 'text-muted-foreground'],
                  ['update', 'Updates', preview.totals.update, 'text-muted-foreground'],
                  ['skip', 'Skipped', preview.totals.skip, preview.totals.errors ? 'text-tone-danger' : 'text-muted-foreground'],
                ] as const).map(([value, text, count, tone]) => (
                  <button key={value} type="button" onClick={() => setFilter(value)} className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors', filter === value ? 'border-border bg-accent font-medium shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
                    {text} <span className={cn('tabular-nums', tone)}>{count}</span>
                  </button>
                ))}
                {busy === 'preview' && <RefreshCw className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Checking" />}
                {preview.totals.errors > 0 && <span className="ml-auto text-sm text-tone-danger">{peopleCount(preview.totals.errors).replace('people', 'rows').replace('person', 'row')} with problems won’t be imported</span>}
              </div>

              <div className="mt-2 overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-[14px]">
                  <thead className="bg-subtle text-left text-sm text-muted-foreground">
                    <tr>
                      <th className="w-12 px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Person</th>
                      <th className="w-24 px-3 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 500).map(r => (
                      <tr key={r.row} className="border-t align-top">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                        <td className="max-w-[240px] px-3 py-2">
                          <div className="truncate">{r.name || '—'}</div>
                          <div className="truncate text-sm text-muted-foreground">{r.email || 'No email'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-2xs font-medium', r.action === 'create' ? 'bg-tone-success/[0.12] text-tone-success' : r.action === 'update' ? 'bg-tone-info/[0.12] text-tone-info' : r.errors.length ? 'bg-tone-danger/[0.1] text-tone-danger' : 'bg-muted text-muted-foreground')}>
                            {r.action === 'create' ? 'Add' : r.action === 'update' ? 'Update' : 'Skip'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm">
                          {r.errors.map((e, i) => (
                            <div key={i} className="text-tone-danger">{e}</div>
                          ))}
                          {r.changes.length > 0 && <div className="text-foreground/80">Changes {r.changes.join(', ')}</div>}
                          {r.notes.map((n, i) => (
                            <div key={i} className="text-muted-foreground">{n}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                    {!shown.length && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">No rows here</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {shown.length > 500 && <p className="border-t px-3 py-2 text-sm text-muted-foreground">Showing the first 500 of {shown.length.toLocaleString()} rows.</p>}
              </div>
              {error && <p className="mt-2 text-[14px] text-tone-danger">{error}</p>}
            </div>
          )}

          {step === 'done' && result && (
            <div className="px-5 py-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-tone-success" />
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold">
                    {result.totals.create ? `Added ${peopleCount(result.totals.create)}` : 'No one new'}
                    {result.totals.update ? ` · updated ${result.totals.update}` : ''}
                  </div>
                  <ul className="mt-2 space-y-1 text-[14px] text-muted-foreground">
                    {result.totals.groupsToCreate.length > 0 && <li>Created {result.totals.groupsToCreate.length === 1 ? 'the group' : 'groups'} {result.totals.groupsToCreate.map(g => `“${g}”`).join(', ')}</li>}
                    {sendInvites && <li>Sent {result.totals.invited} invitation{result.totals.invited === 1 ? '' : 's'}</li>}
                    <li>{result.totals.enrolled ? `Assignment rules created ${result.totals.enrolled} enrollment${result.totals.enrolled === 1 ? '' : 's'}` : 'No assignment rules applied to them'}</li>
                    {result.totals.skip > 0 && <li>{result.totals.skip} row{result.totals.skip === 1 ? ' was' : 's were'} skipped{result.totals.errors ? ` — ${result.totals.errors} had problems` : ''}</li>}
                  </ul>
                  {result.totals.errors > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const bad = result.rows.filter(r => r.errors.length);
                        downloadText('lms-import-problems.csv', toCsv(['Row', 'Email', 'Name', 'Problems'], bad.map(r => [r.row, r.email, r.name, r.errors.join(' · ')])));
                      }}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent"
                    >
                      <Download className="h-3.5 w-3.5" /> Download rows with problems
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <div className="flex items-center gap-2">
            {(step === 'map' || step === 'review') && (
              <button type="button" disabled={Boolean(busy)} onClick={() => setStep(step === 'review' ? 'map' : 'file')} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            {(step === 'map' || step === 'review') && (
              <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
                <Kbd>{MOD}</Kbd>
                <Kbd>↵</Kbd> {step === 'map' ? 'to review' : 'to import'}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'done' ? (
              <>
                <button type="button" onClick={() => { setStep('file'); setCsv(null); setPreview(null); setResult(null); }} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
                  Import another file
                </button>
                <button type="button" onClick={() => { onOpenChange(false); navigate(sendInvites && result?.totals.create ? '/people?tab=invited' : '/people'); }} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                  View people
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy === 'import'} onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
                  Cancel
                </button>
                {step === 'map' && (
                  <button type="button" disabled={mapping.email == null || Boolean(busy)} onClick={() => void runPreview()} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
                    {busy === 'preview' ? 'Checking…' : 'Review import'}
                  </button>
                )}
                {step === 'review' && (
                  <button type="button" disabled={!toImport || Boolean(busy)} onClick={() => void runImport()} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
                    {busy === 'import' ? 'Importing…' : toImport ? `Import ${peopleCount(toImport)}` : 'Nothing to import'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
