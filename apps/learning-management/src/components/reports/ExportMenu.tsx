import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportReport, type ExportReportInputType } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { downloadText } from '../../lib/download';
import { errorMessage } from '../../lib/errors';

export type ExportOption = { label: string; hint: string; input: ExportReportInputType };

/** CSV exports for the current tab, built on the server from the same queries as the screen. */
export function ExportMenu({ options }: { options: ExportOption[] }) {
  const run = useMutation({
    mutationFn: (input: ExportReportInputType) => exportReport(input),
    onSuccess: res => {
      downloadText(res.filename, res.csv);
      if (res.truncated) toast.warning(`Exported the first ${res.rows.toLocaleString()} rows`, { description: 'Narrow the range or filters to export everything.' });
      else toast.success(res.rows ? `Exported ${res.rows.toLocaleString()} ${res.rows === 1 ? 'row' : 'rows'}` : 'Exported an empty file', { description: res.filename });
    },
    onError: e => toast.error(errorMessage(e, "Couldn't export that report")),
  });
  if (!options.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={run.isPending} className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-60 data-[state=open]:bg-accent" aria-label="Export as CSV">
          {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Export</span>
          <ChevronDown className="hidden h-3 w-3 opacity-60 sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Download as CSV</DropdownMenuLabel>
        {options.map(o => (
          <DropdownMenuItem key={o.label} className="items-start gap-2 text-[14px]" onSelect={() => run.mutate(o.input)}>
            <FileSpreadsheet className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block">{o.label}</span>
              <span className="block text-2xs text-muted-foreground">{o.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
