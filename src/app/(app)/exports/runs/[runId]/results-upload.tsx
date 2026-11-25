'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { importResultsAction, previewResultsAction, type ResultsState } from '../../actions';

const MAX_BYTES = 900_000;

/**
 * Upload the bank's / provider's result file for one export: preview first (every row matched to a
 * payee, amounts checked), then save. Nothing is saved while any row has an error.
 */
export function ResultsUpload({ runId, exportId }: { runId: string; exportId: string }) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, previewAction, previewing] = useActionState<ResultsState, FormData>(
    previewResultsAction,
    {},
  );
  const [saved, saveAction, saving] = useActionState<ResultsState, FormData>(
    importResultsAction,
    {},
  );
  const p = preview.preview;

  return (
    <div className="space-y-3">
      <form action={previewAction} className="space-y-2">
        <input type="hidden" name="exportId" value={exportId} />
        <input type="hidden" name="text" value={text} />
        <Label htmlFor={`file-${exportId}`}>Result file from the bank (CSV)</Label>
        <input
          id={`file-${exportId}`}
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setFileError(null);
            if (!f) return setText('');
            if (f.size > MAX_BYTES) {
              setText('');
              return setFileError('The file is too large (limit 900 KB).');
            }
            setText(await f.text());
          }}
        />
        <p className="text-xs text-muted-foreground">
          Needs columns for staff number or account/phone number, amount and status (SUCCESS, PAID,
          FAILED, REJECTED, PENDING…). Reference and reason columns are kept if present.
        </p>
        <Button type="submit" variant="outline" size="sm" disabled={!text || previewing}>
          {previewing ? 'Checking…' : 'Check file'}
        </Button>
        <FormMessage message={fileError ?? preview.error} />
      </form>

      {p ? (
        <div className="space-y-2 text-sm">
          {p.fileErrors.length ? (
            <FormMessage message={p.fileErrors.join(' ')} />
          ) : (
            <>
              <p>
                {p.validCount} row(s) OK, {p.errorCount} with errors
                {p.unmatchedPayees.length
                  ? `, ${p.unmatchedPayees.length} payee(s) not in the file (they stay without a result)`
                  : ''}
                .
              </p>
              <ul className="max-h-56 overflow-auto rounded-md border">
                {p.rows.map((r) => (
                  <li
                    key={r.line}
                    className={`flex flex-wrap justify-between gap-2 border-b px-3 py-1.5 last:border-0 ${r.errors.length ? 'bg-destructive/10' : ''}`}
                  >
                    <span>
                      Line {r.line}: {r.staffNo ?? '—'} {r.name ?? ''}
                    </span>
                    <span className="text-muted-foreground">
                      {r.status ?? '?'}{' '}
                      {r.amount !== null ? `· ${r.amount.toLocaleString('en-UG')}` : ''}
                      {r.errors.length ? ` · ${r.errors.join('; ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {p.errorCount === 0 && p.rows.length > 0 ? (
                <form action={saveAction} className="space-y-2">
                  <input type="hidden" name="exportId" value={exportId} />
                  <input type="hidden" name="runId" value={runId} />
                  <input type="hidden" name="text" value={preview.text ?? ''} />
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? 'Saving…' : `Save ${p.rows.length} result(s)`}
                  </Button>
                </form>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <FormMessage message={saved.error} />
      <FormMessage message={saved.ok} tone="success" />
    </div>
  );
}
