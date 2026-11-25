'use client';

import type { StatutoryRule } from '@prisma/client';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseLstBandsCsv } from '@/lib/settings/lst-csv';
import {
  ruleFormToParams,
  type LstForm,
  type NssfForm,
  type PayeForm,
  type RuleForm,
} from '@/lib/settings/rule-form';
import { createRuleVersionAction, type RuleActionState } from './actions';
import { monthName, RulePreview } from './rule-preview';

export function RuleEditor({
  initial,
  defaultEffectiveFrom,
}: {
  initial: RuleForm;
  defaultEffectiveFrom: string;
}) {
  const [form, setForm] = useState<RuleForm>(initial);
  const [state, action, pending] = useActionState<RuleActionState, FormData>(
    createRuleVersionAction,
    {},
  );
  const preview = useMemo(() => ruleFormToParams(form), [form]);

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="form" value={JSON.stringify(form)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={defaultEffectiveFrom}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sourceUrl">Source (URA / NSSF / council link)</Label>
          <Input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://…" maxLength={500} />
        </div>
      </div>

      {form.rule === 'NSSF' ? (
        <NssfFields value={form.nssf} onChange={(nssf) => setForm({ rule: 'NSSF', nssf })} />
      ) : form.rule === 'LST' ? (
        <LstFields value={form.lst} onChange={(lst) => setForm({ rule: 'LST', lst })} />
      ) : (
        <PayeFields value={form.paye} onChange={(paye) => setForm({ rule: form.rule, paye })} />
      )}

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Preview</h2>
        {preview.ok ? (
          <RulePreview rule={form.rule as StatutoryRule} params={preview.params} />
        ) : (
          <p className="text-sm text-muted-foreground">Fix the form to see a preview: {preview.error}</p>
        )}
      </section>

      <FormMessage message={state.error} />
      <div className="space-y-2">
        <Button type="submit" disabled={pending || !preview.ok}>
          {pending ? 'Saving…' : 'Save as draft'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Drafts are not used by payroll until a Finance Approver (not you) approves them.
        </p>
      </div>
    </form>
  );
}

// ───────────────────────────── PAYE ─────────────────────────────

function PayeFields({ value, onChange }: { value: PayeForm; onChange: (v: PayeForm) => void }) {
  const setBand = (i: number, patch: Partial<PayeForm['bands'][number]>) =>
    onChange({ ...value, bands: value.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  function addBand() {
    const last = value.bands.at(-1);
    onChange({ ...value, bands: [...value.bands, { from: last?.to ?? '', to: '', rate: '' }] });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium">Monthly bands</h2>
        <p className="text-sm text-muted-foreground">
          Start at 0, each band starts where the previous one ends, and leave “To” blank on the last.
        </p>
      </div>
      <BandTable
        headers={['From (UGX)', 'To (UGX)', 'Rate (%)']}
        rows={value.bands.map((b, i) => [
          <Input key="f" aria-label={`Band ${i + 1} from`} inputMode="numeric" value={b.from} onChange={(e) => setBand(i, { from: e.target.value })} />,
          <Input key="t" aria-label={`Band ${i + 1} to`} inputMode="numeric" value={b.to} placeholder="and above" onChange={(e) => setBand(i, { to: e.target.value })} />,
          <Input key="r" aria-label={`Band ${i + 1} rate`} inputMode="decimal" value={b.rate} onChange={(e) => setBand(i, { rate: e.target.value })} />,
        ])}
        onRemove={(i) => onChange({ ...value, bands: value.bands.filter((_, j) => j !== i) })}
        onAdd={addBand}
        addLabel="Add band"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="surchargeThreshold">Surcharge above (UGX)</Label>
          <Input id="surchargeThreshold" inputMode="numeric" value={value.surchargeThreshold} placeholder="Leave blank for none" onChange={(e) => onChange({ ...value, surchargeThreshold: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="surchargeRate">Surcharge rate (%)</Label>
          <Input id="surchargeRate" inputMode="decimal" value={value.surchargeRate} onChange={(e) => onChange({ ...value, surchargeRate: e.target.value })} />
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────── NSSF ─────────────────────────────

function NssfFields({ value, onChange }: { value: NssfForm; onChange: (v: NssfForm) => void }) {
  return (
    <section className="space-y-4">
      <h2 className="font-medium">Contribution rates</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="employeeRate">Employee (%)</Label>
          <Input id="employeeRate" inputMode="decimal" required value={value.employeeRate} onChange={(e) => onChange({ ...value, employeeRate: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="employerRate">Employer (%)</Label>
          <Input id="employerRate" inputMode="decimal" required value={value.employerRate} onChange={(e) => onChange({ ...value, employerRate: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ceiling">Monthly ceiling (UGX)</Label>
          <Input id="ceiling" inputMode="numeric" value={value.ceiling} placeholder="None" onChange={(e) => onChange({ ...value, ceiling: e.target.value })} />
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────── LST ─────────────────────────────

function LstFields({ value, onChange }: { value: LstForm; onChange: (v: LstForm) => void }) {
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const setBand = (i: number, patch: Partial<LstForm['bands'][number]>) =>
    onChange({ ...value, bands: value.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  async function importCsv(file: File | undefined) {
    if (!file) return;
    const result = parseLstBandsCsv(await file.text());
    if (!result.ok) {
      setCsvErrors(result.errors);
      return;
    }
    setCsvErrors([]);
    onChange({
      ...value,
      bands: result.bands.map((b) => ({
        from: String(b.from),
        to: b.to === null ? '' : String(b.to),
        annual: String(b.annual),
      })),
    });
  }

  function toggleMonth(m: number) {
    const months = value.months.includes(m)
      ? value.months.filter((x) => x !== m)
      : [...value.months, m].sort((a, b) => a - b);
    onChange({ ...value, months });
  }

  return (
    <section className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-medium">Bands (monthly gross → annual LST)</h2>
            <p className="text-sm text-muted-foreground">
              Enter by hand or import a CSV with columns <code>from,to,annual</code>.
            </p>
          </div>
          <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            <Upload className="size-4" aria-hidden />
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                void importCsv(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </Label>
        </div>
        {csvErrors.length ? (
          <ul role="alert" className="space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {csvErrors.slice(0, 10).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <BandTable
          headers={['From (UGX)', 'To (UGX)', 'Annual LST (UGX)']}
          rows={value.bands.map((b, i) => [
            <Input key="f" aria-label={`Band ${i + 1} from`} inputMode="numeric" value={b.from} onChange={(e) => setBand(i, { from: e.target.value })} />,
            <Input key="t" aria-label={`Band ${i + 1} to`} inputMode="numeric" value={b.to} placeholder="and above" onChange={(e) => setBand(i, { to: e.target.value })} />,
            <Input key="a" aria-label={`Band ${i + 1} annual`} inputMode="numeric" value={b.annual} onChange={(e) => setBand(i, { annual: e.target.value })} />,
          ])}
          onRemove={(i) => onChange({ ...value, bands: value.bands.filter((_, j) => j !== i) })}
          onAdd={() => {
            const last = value.bands.at(-1);
            onChange({
              ...value,
              bands: [...value.bands, { from: last?.to ?? (value.bands.length ? '' : '0'), to: '', annual: '' }],
            });
          }}
          addLabel="Add band"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="instalments">Instalments</Label>
          <Input id="instalments" inputMode="numeric" value={value.instalments} onChange={(e) => onChange({ ...value, instalments: e.target.value })} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Collected in</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={value.months.includes(m)} onChange={() => toggleMonth(m)} className="size-4 accent-primary" />
                {monthName(m)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

// ───────────────────────────── shared ─────────────────────────────

function BandTable({
  headers,
  rows,
  onRemove,
  onAdd,
  addLabel,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  onRemove: (i: number) => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_1fr_1fr_2.25rem] gap-2 px-0.5 text-xs font-medium text-muted-foreground sm:grid">
        {headers.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      {rows.map((cells, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_2.25rem] gap-2">
          {cells}
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove band ${i + 1}`} onClick={() => onRemove(i)}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus aria-hidden /> {addLabel}
      </Button>
    </div>
  );
}
