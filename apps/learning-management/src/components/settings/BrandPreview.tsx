import { Check, Info, Moon, Sun } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { cn } from '@project/components/lib/utils';
import { brandReport } from './brandTokens';

/**
 * The top of the academy in both learner themes, painted with the exact
 * colours the learner app will compute for this brand colour. Pinned palettes
 * (the learner app's warm paper and charcoal), not the admin app's tokens, so
 * it looks the same whichever theme you're in.
 */

const PAPER = {
  light: { bg: 'hsl(40 40% 99.4%)', canvas: 'hsl(38 30% 97%)', fg: 'hsl(28 9% 13%)', muted: 'hsl(30 7% 38%)', track: 'hsl(36 20% 93.5%)', border: 'hsl(34 15% 87.5%)', card: 'hsl(40 40% 99.4%)' },
  dark: { bg: 'hsl(30 7% 10%)', canvas: 'hsl(30 8% 7%)', fg: 'hsl(36 16% 92%)', muted: 'hsl(34 9% 68%)', track: 'hsl(30 6% 16%)', border: 'hsl(30 6% 19%)', card: 'hsl(30 7% 11%)' },
};

const SERIF = "'Source Serif 4', 'Iowan Old Style', Georgia, serif";

function Pane({ tone, primary, foreground, academyName, headline, logoUrl }: { tone: 'light' | 'dark'; primary: string; foreground: string; academyName: string; headline: string; logoUrl: string | null }) {
  const p = PAPER[tone];
  const [broken, setBroken] = useState(false);
  const brand = `hsl(${primary})`;
  const onBrand = `hsl(${foreground})`;
  const style: CSSProperties = { background: p.canvas, color: p.fg, borderColor: p.border, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" };
  return (
    <div className="overflow-hidden rounded-lg border" style={style} aria-label={`Academy preview, ${tone} theme`} data-preview={tone}>
      <div className="flex h-10 items-center gap-2 px-3" style={{ background: p.bg, borderBottom: `1px solid ${p.border}` }}>
        {logoUrl && !broken ? (
          <img src={logoUrl} alt="" className="h-5 max-w-[64px] object-contain" onError={() => setBroken(true)} />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] text-[11px] font-bold" style={{ background: brand, color: onBrand }}>
            {academyName.trim().charAt(0).toUpperCase() || 'A'}
          </span>
        )}
        <span className="min-w-0 truncate text-[14px] font-semibold" style={{ fontFamily: SERIF }}>{academyName || 'Academy'}</span>
        <span className="ml-auto hidden items-center gap-3 text-[12px] sm:flex">
          <span className="font-medium" style={{ color: brand }}>Home</span>
          <span style={{ color: p.muted }}>Catalog</span>
        </span>
        <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: p.track, border: `1px solid ${p.border}` }} />
      </div>
      <div className="px-4 pb-4 pt-3.5">
        <div className="text-[11.5px]" style={{ color: p.muted }}>Welcome back, Priya</div>
        <div className="mt-0.5 line-clamp-2 text-[18px] font-semibold leading-tight" style={{ fontFamily: SERIF, letterSpacing: '-0.005em' }}>{headline || 'Learn something new today'}</div>
        <div className="mt-3 rounded-lg p-3" style={{ background: p.card, border: `1px solid ${p.border}` }}>
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate font-medium">Security Awareness Essentials</span>
            <span className="shrink-0 tabular-nums" style={{ color: p.muted }}>64%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: p.track }}>
            <div className="h-full rounded-full" style={{ width: '64%', background: brand }} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium" style={{ background: brand, color: onBrand }}>Continue</span>
            <span className="text-[12.5px] font-medium underline-offset-2" style={{ color: brand }}>View certificate</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrandPreview({ hex, academyName, headline, logoUrl }: { hex: string; academyName: string; headline: string; logoUrl: string | null }) {
  const report = brandReport(hex);
  const rows: Array<{ tone: 'light' | 'dark'; label: string; icon: typeof Sun; r: typeof report.light; bar: number }> = [
    { tone: 'light', label: 'Light', icon: Sun, r: report.light, bar: 4.5 },
    { tone: 'dark', label: 'Dark', icon: Moon, r: report.dark, bar: 7 },
  ];
  const adjusted = rows.filter(x => x.r.adjusted);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(x => (
          <div key={x.tone} className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <x.icon className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{x.label}</span>
              <span className="ml-auto flex items-center gap-1 tabular-nums" data-contrast={x.tone}>
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: x.r.hex }} aria-hidden />
                {x.r.hex.toUpperCase()} · {x.r.ratio.toFixed(1)}:1
                {x.r.ratio >= x.bar - 0.05 && <Check className="h-3 w-3 text-tone-success" aria-label="Readable" />}
              </span>
            </div>
            <Pane tone={x.tone} primary={report.tokens[x.tone].primary} foreground={report.tokens[x.tone].foreground} academyName={academyName} headline={headline} logoUrl={logoUrl} />
          </div>
        ))}
      </div>
      <p className={cn('flex items-start gap-2 rounded-md px-2.5 py-2 text-sm', 'bg-subtle text-muted-foreground')}>
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          The academy keeps your colour’s hue and adjusts its lightness only as far as it needs to, so buttons and links stay readable — at least 4.5:1 on light paper and 7:1 in dark mode. Button text switches between white and near-black to match.
          {adjusted.length > 0 && (
            <span className="text-foreground"> {adjusted.length === 2 ? 'Both themes use' : `The ${adjusted[0].label.toLowerCase()} theme uses`} an adjusted shade of this colour.</span>
          )}
        </span>
      </p>
    </div>
  );
}
