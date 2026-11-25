'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  COLUMN_FORMATS,
  EXPORT_FIELDS,
  FIELD_LABELS,
  FORMAT_LABELS,
  rowsToText,
  type ExportColumn,
  type ExportTemplateSpec,
} from '@/lib/exports/template';
import type { ActionState } from '../../actions';

export function TemplateEditor({
  action,
  initial,
  tokens,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  initial: ExportTemplateSpec;
  tokens: string[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [columns, setColumns] = useState<ExportColumn[]>(initial.mapping.columns);

  const update = (i: number, patch: Partial<ExportColumn>) =>
    setColumns((cols) => cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) =>
    setColumns((cols) => {
      const j = i + d;
      if (j < 0 || j >= cols.length) return cols;
      const next = [...cols];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="columns" value={JSON.stringify(columns)} />
      <Card>
        <CardHeader>
          <CardTitle>File format and columns</CardTitle>
          <CardDescription>
            Columns appear in this order. Amounts are net pay in whole shillings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="format">File type</Label>
              <NativeSelect id="format" name="format" defaultValue={initial.format}>
                <option value="CSV">CSV</option>
                <option value="XLSX">Excel (XLSX)</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="narrative">Narrative</Label>
              <Input
                id="narrative"
                name="narrative"
                maxLength={60}
                defaultValue={initial.mapping.narrative}
              />
            </div>
          </div>

          <ol className="space-y-3">
            {columns.map((c, i) => (
              <li
                key={i}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
              >
                <div className="space-y-1">
                  <Label htmlFor={`h${i}`}>Header</Label>
                  <Input
                    id={`h${i}`}
                    value={c.header}
                    maxLength={60}
                    onChange={(e) => update(i, { header: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`f${i}`}>Field</Label>
                  <NativeSelect
                    id={`f${i}`}
                    value={c.field}
                    onChange={(e) => update(i, { field: e.target.value as ExportColumn['field'] })}
                  >
                    {EXPORT_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`fmt${i}`}>Format</Label>
                  <NativeSelect
                    id={`fmt${i}`}
                    value={c.format}
                    onChange={(e) =>
                      update(i, { format: e.target.value as ExportColumn['format'] })
                    }
                  >
                    {COLUMN_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABELS[f]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove column"
                    onClick={() => setColumns((cols) => cols.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setColumns((cols) => [
                ...cols,
                { header: 'New column', field: 'staffNo', format: 'AS_IS' },
              ])
            }
          >
            <Plus /> Add column
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Header and footer rows</CardTitle>
          <CardDescription>
            One row per line; separate cells with “|”. Tokens: {tokens.join(' ')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="includeColumnHeaders"
              defaultChecked={initial.headerRules.includeColumnHeaders}
            />
            Include a row of column headers
          </label>
          <div className="space-y-2">
            <Label htmlFor="headerRows">Rows before the column headers</Label>
            <textarea
              id="headerRows"
              name="headerRows"
              rows={3}
              defaultValue={rowsToText(initial.headerRules.rows)}
              placeholder="BATCH | {batchRef} | {payDate}"
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="footerRows">Rows after the data</Label>
            <textarea
              id="footerRows"
              name="footerRows"
              rows={3}
              defaultValue={rowsToText(initial.footerRules.rows)}
              placeholder="TOTAL | {count} | {total}"
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Button type="submit" disabled={pending || columns.length === 0}>
          {pending ? 'Saving…' : 'Save template'}
        </Button>
        <FormMessage message={state.error} />
        <FormMessage message={state.ok} tone="success" />
      </div>
    </form>
  );
}
