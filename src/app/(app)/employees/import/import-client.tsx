'use client';

import { CheckCircle2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { FormMessage } from '@/components/form-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ImportResult } from '@/lib/employees/import';
import type { ImportSummary } from '@/lib/employees/service';
import { commitImportAction, previewImportAction } from './actions';

const MAX_BYTES = 900_000;
const PREVIEW_LIMIT = 200;

export function ImportClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [mode, setMode] = useState<'ALL_OR_NOTHING' | 'VALID_ONLY'>('ALL_OR_NOTHING');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFileName(null);
    setText(null);
    setPreview(null);
    setError(null);
    setSummary(null);
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('File is larger than 900 KB. Split it into smaller files.');
      return;
    }
    const content = await file.text();
    setFileName(file.name);
    setText(content);
    startTransition(async () => {
      const r = await previewImportAction(content);
      if ('error' in r) setError(r.error);
      else setPreview(r);
    });
  }

  function onCommit() {
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const r = await commitImportAction({ text, mode, fileName });
      if ('error' in r) setError(r.error);
      else {
        setSummary(r.summary);
        setPreview(null);
        setText(null);
      }
    });
  }

  if (summary) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 p-4 text-sm"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Import complete</p>
            <p>
              {summary.created} employee(s) created, {summary.bankAccounts} payment destination(s)
              and {summary.basicSalaries} basic salary assignment(s) added
              {summary.skipped ? `, ${summary.skipped} row(s) skipped because of errors` : ''}.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/employees">View employees</Link>
          </Button>
          <Button variant="outline" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  const rows = preview
    ? onlyErrors
      ? preview.rows.filter((r) => r.errors.length)
      : preview.rows
    : [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="file">CSV file</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="file"
            type="file"
            accept=".csv,text/csv"
            className="max-w-sm"
            onChange={(e) => onFile(e.target.files?.[0])}
            disabled={pending}
          />
          {pending && !preview ? (
            <span className="text-sm text-muted-foreground">Checking file…</span>
          ) : null}
        </div>
      </div>

      <FormMessage message={error} />

      {preview ? (
        <div className="space-y-4">
          {preview.fileErrors.length ? (
            <div
              role="alert"
              className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {preview.fileErrors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          ) : null}

          {preview.rows.length ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{fileName}</span>
                <Badge variant="success">{preview.validCount} ready</Badge>
                {preview.errorCount ? (
                  <Badge variant="destructive">{preview.errorCount} with errors</Badge>
                ) : null}
                {preview.errorCount ? (
                  <label className="ml-auto flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onlyErrors}
                      onChange={(e) => setOnlyErrors(e.target.checked)}
                      className="size-4 accent-primary"
                    />
                    Show only rows with errors
                  </label>
                ) : null}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Line</TableHead>
                    <TableHead>Staff no.</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                    <TableRow key={r.line} className="align-top">
                      <TableCell className="tabular-nums text-muted-foreground">{r.line}</TableCell>
                      <TableCell className="font-mono text-sm">{r.staffNo || '—'}</TableCell>
                      <TableCell className="text-sm">{r.name || '—'}</TableCell>
                      <TableCell className="text-sm">
                        {r.errors.length === 0 ? (
                          <span className="text-success">
                            Ready
                            {r.row?.bankAccount ? ' · payment details' : ''}
                            {r.row?.basicSalary !== null && r.row?.basicSalary !== undefined
                              ? ' · basic salary'
                              : ''}
                          </span>
                        ) : (
                          <ul className="list-disc space-y-0.5 pl-4 text-destructive">
                            {r.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > PREVIEW_LIMIT ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {PREVIEW_LIMIT} of {rows.length} rows.
                </p>
              ) : null}

              <fieldset className="space-y-2 rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">How to import</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    value="ALL_OR_NOTHING"
                    checked={mode === 'ALL_OR_NOTHING'}
                    onChange={() => setMode('ALL_OR_NOTHING')}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <strong>All or nothing</strong> — save only if every row is valid.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    value="VALID_ONLY"
                    checked={mode === 'VALID_ONLY'}
                    onChange={() => setMode('VALID_ONLY')}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <strong>Import valid rows only</strong> — skip rows with errors.
                  </span>
                </label>
              </fieldset>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={onCommit}
                  disabled={
                    pending ||
                    preview.validCount === 0 ||
                    (mode === 'ALL_OR_NOTHING' && preview.errorCount > 0)
                  }
                >
                  <Upload aria-hidden />
                  {pending
                    ? 'Importing…'
                    : `Import ${mode === 'VALID_ONLY' ? preview.validCount : preview.rows.length} employee(s)`}
                </Button>
                <Button variant="ghost" onClick={reset} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
