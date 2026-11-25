'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { ExportError, generateBankExport, transitionRun } from '@/lib/exports/service';
import {
  footerRulesSchema,
  headerRulesSchema,
  mappingSchema,
  parseRowsText,
} from '@/lib/exports/template';
import { ExportTotalsError } from '@/lib/exports/build';
import {
  importPaymentResults,
  previewPaymentResults,
  reissueFailedPayments,
  runPaymentSummary,
} from '@/lib/exports/payments';
import type { ResultsParse } from '@/lib/exports/results';
import { assertPermission } from '@/lib/rbac';

export interface ActionState {
  error?: string;
  ok?: string;
}

const id = z.string().min(1).max(40);

function failure(e: unknown): ActionState {
  if (e instanceof ExportError || e instanceof ExportTotalsError) return { error: e.message };
  console.error(e);
  return { error: 'Something went wrong. Nothing was saved.' };
}

export async function generateExportAction(
  runId: string,
  bankId: string,
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const actor = await assertPermission('exports.generate');
  const parsed = z.object({ runId: id, bankId: id }).safeParse({ runId, bankId });
  if (!parsed.success) return { error: 'Invalid request.' };
  try {
    const created = await generateBankExport(db, runId, bankId, {
      actorId: actor.id,
      ip: await currentIp(),
    });
    revalidatePath(`/exports/runs/${runId}`);
    return { ok: `Version ${created.version} generated (${created.rowCount} payees).` };
  } catch (e) {
    return failure(e);
  }
}

const transitionSchema = z.enum(['EXPORTED', 'PAID', 'LOCKED']);

/** Text Finance must type to mark a run paid while results are missing or payments failed. */
const PAID_CONFIRM_WORD = 'CONFIRM';

export async function transitionRunAction(
  runId: string,
  to: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const target = transitionSchema.safeParse(to);
  if (!target.success || !id.safeParse(runId).success) return { error: 'Invalid request.' };
  const actor = await assertPermission(
    target.data === 'EXPORTED' ? 'exports.generate' : 'payroll.markPaid',
  );
  try {
    if (target.data === 'PAID') {
      const sum = await runPaymentSummary(db, runId);
      const issues = sum.failed.length + sum.pending + sum.noResult;
      const typed = String(form.get('confirm') ?? '')
        .trim()
        .toUpperCase();
      if (issues > 0 && typed !== PAID_CONFIRM_WORD) {
        return {
          error: `${sum.failed.length} failed, ${sum.pending} pending and ${sum.noResult} without a bank result. Type ${PAID_CONFIRM_WORD} to mark the run paid anyway.`,
        };
      }
    }
    await transitionRun(db, runId, target.data, { actorId: actor.id, ip: await currentIp() });
    revalidatePath(`/exports/runs/${runId}`);
    revalidatePath('/exports');
    return { ok: `Run marked ${target.data.toLowerCase()}.` };
  } catch (e) {
    return failure(e);
  }
}

// ── Templates ───────────────────────────────────────────────────────────

const templateFormSchema = z.object({
  format: z.enum(['CSV', 'XLSX']),
  columns: z.string().max(10_000),
  narrative: z.string().max(60),
  includeColumnHeaders: z.boolean(),
  headerRows: z.string().max(5_000),
  footerRows: z.string().max(5_000),
});

export async function saveTemplateAction(
  bankId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await assertPermission('templates.manage');
  if (!id.safeParse(bankId).success) return { error: 'Invalid bank.' };
  const raw = templateFormSchema.safeParse({
    format: form.get('format'),
    columns: form.get('columns') ?? '[]',
    narrative: form.get('narrative') ?? '',
    includeColumnHeaders: form.get('includeColumnHeaders') === 'on',
    headerRows: form.get('headerRows') ?? '',
    footerRows: form.get('footerRows') ?? '',
  });
  if (!raw.success) return { error: raw.error.issues[0]?.message ?? 'Invalid template.' };

  let columnsJson: unknown;
  try {
    columnsJson = JSON.parse(raw.data.columns);
  } catch {
    return { error: 'Columns could not be read. Reload the page and try again.' };
  }
  const mapping = mappingSchema.safeParse({ columns: columnsJson, narrative: raw.data.narrative });
  if (!mapping.success) return { error: mapping.error.issues[0]?.message ?? 'Invalid columns.' };
  const headerRules = headerRulesSchema.safeParse({
    includeColumnHeaders: raw.data.includeColumnHeaders,
    rows: parseRowsText(raw.data.headerRows),
  });
  const footerRules = footerRulesSchema.safeParse({ rows: parseRowsText(raw.data.footerRows) });
  if (!headerRules.success || !footerRules.success) {
    return { error: 'Header/footer rows are too long (max 10 rows of 30 cells).' };
  }

  const bank = await db.bank.findUnique({
    where: { id: bankId },
    select: { id: true, name: true },
  });
  if (!bank) return { error: 'Bank not found.' };
  const ip = await currentIp();

  await db.$transaction(async (tx) => {
    const existing = await tx.exportTemplate.findFirst({
      where: { bankId },
      orderBy: { updatedAt: 'desc' },
    });
    const data = {
      format: raw.data.format,
      mapping: mapping.data,
      headerRules: headerRules.data,
      footerRules: footerRules.data,
    };
    const saved = existing
      ? await tx.exportTemplate.update({ where: { id: existing.id }, data })
      : await tx.exportTemplate.create({ data: { bankId, ...data } });
    await withAudit(tx, {
      actorId: actor.id,
      action: existing ? 'EXPORT_TEMPLATE_UPDATED' : 'EXPORT_TEMPLATE_CREATED',
      entity: 'ExportTemplate',
      entityId: saved.id,
      before: existing
        ? {
            format: existing.format,
            mapping: existing.mapping,
            headerRules: existing.headerRules,
            footerRules: existing.footerRules,
          }
        : null,
      after: { bank: bank.name, ...data },
      ip,
    });
  });
  revalidatePath('/exports/templates');
  revalidatePath(`/exports/templates/${bankId}`);
  return { ok: 'Template saved. New bank files will use it.' };
}

export async function resetTemplateAction(
  bankId: string,
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const actor = await assertPermission('templates.manage');
  if (!id.safeParse(bankId).success) return { error: 'Invalid bank.' };
  const ip = await currentIp();
  const removed = await db.$transaction(async (tx) => {
    const existing = await tx.exportTemplate.findMany({ where: { bankId } });
    if (existing.length === 0) return 0;
    await tx.exportTemplate.deleteMany({ where: { bankId } });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'EXPORT_TEMPLATE_RESET',
      entity: 'ExportTemplate',
      entityId: existing[0]!.id,
      before: existing.map((t) => ({
        format: t.format,
        mapping: t.mapping,
        headerRules: t.headerRules,
        footerRules: t.footerRules,
      })),
      after: { bankId, usesDefault: true },
      ip,
    });
    return existing.length;
  });
  revalidatePath('/exports/templates');
  revalidatePath(`/exports/templates/${bankId}`);
  return { ok: removed ? 'Reset to the default template.' : 'Already using the default template.' };
}

// ── Payment results (Finance) ────────────────────────────────────────────

export interface ResultsState extends ActionState {
  preview?: ResultsParse;
  text?: string;
}

const resultsSchema = z.object({
  exportId: id,
  text: z.string().min(1, 'Choose a file').max(2_000_000),
});

export async function previewResultsAction(
  _p: ResultsState,
  form: FormData,
): Promise<ResultsState> {
  await assertPermission('payments.upload');
  const parsed = resultsSchema.safeParse({
    exportId: form.get('exportId'),
    text: form.get('text'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  try {
    const preview = await previewPaymentResults(db, parsed.data.exportId, parsed.data.text);
    return { preview, text: parsed.data.text };
  } catch (e) {
    return failure(e);
  }
}

export async function importResultsAction(_p: ResultsState, form: FormData): Promise<ResultsState> {
  const actor = await assertPermission('payments.upload');
  const parsed = resultsSchema.safeParse({
    exportId: form.get('exportId'),
    text: form.get('text'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  try {
    const r = await importPaymentResults(db, parsed.data.exportId, parsed.data.text, {
      actorId: actor.id,
      ip: await currentIp(),
    });
    const runId = String(form.get('runId') ?? '');
    if (runId) revalidatePath(`/exports/runs/${runId}`);
    return {
      ok: `Saved: ${r.PAID} paid, ${r.FAILED} failed, ${r.PENDING} pending${r.notInFile ? `, ${r.notInFile} payee(s) not in the file` : ''}.`,
    };
  } catch (e) {
    return failure(e);
  }
}

export async function reissueAction(
  runId: string,
  bankId: string,
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const actor = await assertPermission('exports.generate');
  if (!id.safeParse(runId).success || !id.safeParse(bankId).success)
    return { error: 'Invalid request.' };
  try {
    const created = await reissueFailedPayments(db, runId, bankId, {
      actorId: actor.id,
      ip: await currentIp(),
    });
    revalidatePath(`/exports/runs/${runId}`);
    return {
      ok: `Re-issue file version ${created.version} generated (${created.rowCount} payee(s)).`,
    };
  } catch (e) {
    return failure(e);
  }
}
