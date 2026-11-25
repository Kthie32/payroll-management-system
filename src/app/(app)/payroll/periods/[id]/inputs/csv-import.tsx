'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { importCsvAction, previewCsvAction, type PreviewState } from '../../../actions';

const MAX_BYTES = 2_000_000;

export function CsvImport({ periodId }: { periodId: string }) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, previewAction, previewing] = useActionState<PreviewState, FormData>(
    previewCsvAction,
    {},
  );
  const [result, importAction, importing] = useActionState<PreviewState, FormData>(
    importCsvAction,
    {},
  );
  const p = preview.preview;
  const canImport =
    p &&
    p.fileErrors.length === 0 &&
    p.errorCount === 0 &&
    p.validCount > 0 &&
    preview.text === text;

  return (
    <div className="space-y-3">
      <form action={previewAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="periodId" value={periodId} />
        <input type="hidden" name="text" value={text} />
        <div className="space-y-2">
          <Label htmlFor="csv">CSV file</Label>
          <Input
            id="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              setFileError(null);
              const file = e.target.files?.[0];
              if (!file) return setText('');
              if (file.size > MAX_BYTES) {
                setText('');
                return setFileError('The file is larger than 2 MB.');
              }
              setText(await file.text());
            }}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!text || previewing}>
          {previewing ? 'Checking…' : 'Check file'}
        </Button>
      </form>
      <FormMessage message={fileError} />
      <FormMessage message={preview.error} />

      {p ? (
        <div className="space-y-2">
          {p.fileErrors.map((e) => (
            <FormMessage key={e} message={e} />
          ))}
          {p.rows.length > 0 ? (
            <>
              <p className="text-sm">
                {p.validCount} valid row(s), {p.errorCount} with errors.
              </p>
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-2 py-1">Line</th>
                      <th className="px-2 py-1">Staff no.</th>
                      <th className="px-2 py-1">Component</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                      <th className="px-2 py-1">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((r) => (
                      <tr
                        key={r.line}
                        className={r.errors.length ? 'border-b bg-destructive/5' : 'border-b'}
                      >
                        <td className="px-2 py-1 tabular-nums">{r.line}</td>
                        <td className="px-2 py-1">
                          {r.staffNo}
                          {r.employeeName ? (
                            <span className="text-muted-foreground"> · {r.employeeName}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1">{r.componentCode}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.quantity ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {r.amount?.toLocaleString('en-UG') ?? ''}
                        </td>
                        <td className="px-2 py-1 text-xs">
                          {r.errors.length ? (
                            <span className="text-destructive">{r.errors.join('; ')}</span>
                          ) : (
                            <span className="text-success">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {canImport ? (
            <form action={importAction}>
              <input type="hidden" name="periodId" value={periodId} />
              <input type="hidden" name="text" value={text} />
              <Button type="submit" disabled={importing}>
                {importing ? 'Importing…' : `Import ${p.validCount} row(s)`}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <FormMessage message={result.error} />
      <FormMessage message={result.message} tone="success" />
    </div>
  );
}
