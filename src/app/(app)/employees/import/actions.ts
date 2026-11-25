'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import {
  type ImportResult,
  importModeSchema,
  MAX_IMPORT_BYTES,
  validateImport,
} from '@/lib/employees/import';
import {
  commitImport,
  EmployeeError,
  type ImportSummary,
  loadImportLookups,
} from '@/lib/employees/service';
import { assertPermission } from '@/lib/rbac';

const textSchema = z.string().max(MAX_IMPORT_BYTES, 'File is larger than 900 KB.');

export type PreviewResult = ImportResult | { error: string };

/** Validates a CSV file against the database without saving anything. */
export async function previewImportAction(text: string): Promise<PreviewResult> {
  await assertPermission('employees.edit');
  const parsed = textSchema.safeParse(text);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid file.' };
  return validateImport(parsed.data, await loadImportLookups(db));
}

const commitSchema = z.object({
  text: textSchema,
  mode: importModeSchema,
  fileName: z.string().max(200).nullable(),
});

export type CommitResult = { summary: ImportSummary } | { error: string };

/**
 * Re-validates on the server (the preview may be stale) and saves in one transaction.
 * ALL_OR_NOTHING refuses to save if any row has an error; VALID_ONLY skips bad rows.
 */
export async function commitImportAction(input: {
  text: string;
  mode: string;
  fileName: string | null;
}): Promise<CommitResult> {
  const user = await assertPermission('employees.edit');
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  const { text, mode, fileName } = parsed.data;
  const ip = await currentIp();

  try {
    const summary = await db.$transaction(
      async (tx) => {
        const result = validateImport(text, await loadImportLookups(tx));
        if (result.fileErrors.length && result.rows.length === 0) {
          throw new EmployeeError(result.fileErrors[0] ?? 'Invalid file.');
        }
        if (mode === 'ALL_OR_NOTHING' && result.errorCount > 0) {
          throw new EmployeeError(
            `${result.errorCount} row(s) have errors. Fix them or choose "import valid rows only".`,
          );
        }
        const valid = result.rows.flatMap((r) => (r.row ? [r.row] : []));
        if (valid.length === 0) throw new EmployeeError('There are no valid rows to import.');
        return commitImport(
          tx,
          valid,
          { mode, totalRows: result.rows.length, fileName },
          { id: user.id, ip },
        );
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    revalidatePath('/employees');
    return { summary };
  } catch (e) {
    if (e instanceof EmployeeError) return { error: e.message };
    throw e;
  }
}
