'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentIp } from '@/lib/auth/request';
import { isIsoDate } from '@/lib/payroll/dates';
import { PeriodGenerationError } from '@/lib/payroll/periods';
import { computeRun } from '@/lib/payroll/server/compute';
import { RunActionError } from '@/lib/payroll/server/errors';
import {
  deleteImportedInputs,
  generatePeriodsForGroup,
  importInputsCsv,
  previewInputsCsv,
  saveManualInputs,
  updatePayDate,
} from '@/lib/payroll/server/periods-inputs';
import { approveRun, createRun, deleteRun, rejectRun, submitRun } from '@/lib/payroll/server/workflow';
import type { ParseResult } from '@/lib/payroll/csv-inputs';
import { assertPermission, ForbiddenError } from '@/lib/rbac';

export interface ActionState {
  error?: string;
  message?: string;
}

const id = z.string().min(1).max(64);
const isoDate = z.string().refine(isIsoDate, 'Enter a valid date');

/** Turns known failures into form errors; rethrows anything else (incl. Next redirects). */
function toState(e: unknown): ActionState {
  if (e instanceof RunActionError || e instanceof PeriodGenerationError) return { error: e.message };
  if (e instanceof ForbiddenError) return { error: 'You do not have permission to do that.' };
  throw e;
}

// ── Periods ─────────────────────────────────────────────────────────────

const generateSchema = z.object({
  payGroupId: id,
  from: z.string().regex(/^\d{4}-\d{2}$/, 'Pick a start month'),
  to: z.string().regex(/^\d{4}-\d{2}$/, 'Pick an end month'),
  anchor: z.union([isoDate, z.literal('')]).optional(),
});

export async function generatePeriodsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission('payroll.prepare');
    const parsed = generateSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const { payGroupId, from, to, anchor } = parsed.data;
    const r = await generatePeriodsForGroup(
      payGroupId,
      { from, to, ...(anchor ? { anchor } : {}) },
      actor.id,
      await currentIp(),
    );
    revalidatePath('/payroll/periods');
    return {
      message:
        r.created === 0
          ? `No new periods — all ${r.skipped} already exist.`
          : `Created ${r.created} period(s)${r.skipped ? `; ${r.skipped} already existed` : ''}.`,
    };
  } catch (e) {
    return toState(e);
  }
}

export async function updatePayDateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission('payroll.prepare');
    const parsed = z.object({ periodId: id, payDate: isoDate }).safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    await updatePayDate(parsed.data.periodId, parsed.data.payDate, actor.id, await currentIp());
    revalidatePath('/payroll/periods');
    return { message: 'Pay date updated.' };
  } catch (e) {
    return toState(e);
  }
}

// ── Inputs ──────────────────────────────────────────────────────────────

export async function saveInputsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission('payroll.prepare');
    const periodId = id.parse(fd.get('periodId'));
    const cells: Array<{ employeeId: string; componentId: string; value: string }> = [];
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith('cell:') || typeof value !== 'string') continue;
      const [, employeeId, componentId] = key.split(':');
      if (employeeId && componentId) cells.push({ employeeId, componentId, value });
    }
    if (cells.length > 50_000) return { error: 'Too many cells.' };
    const n = await saveManualInputs(periodId, cells, actor.id, await currentIp());
    revalidatePath(`/payroll/periods/${periodId}/inputs`);
    return { message: `Saved ${n} input(s).` };
  } catch (e) {
    return toState(e);
  }
}

export interface PreviewState extends ActionState {
  preview?: ParseResult;
  text?: string;
}

const csvSchema = z.object({ periodId: id, text: z.string().min(1, 'Choose a CSV file').max(2_000_000) });

export async function previewCsvAction(_p: PreviewState, fd: FormData): Promise<PreviewState> {
  try {
    await assertPermission('payroll.prepare');
    const parsed = csvSchema.safeParse({ periodId: fd.get('periodId'), text: fd.get('text') });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const preview = await previewInputsCsv(parsed.data.periodId, parsed.data.text);
    return { preview, text: parsed.data.text };
  } catch (e) {
    return toState(e);
  }
}

export async function importCsvAction(_p: PreviewState, fd: FormData): Promise<PreviewState> {
  try {
    const actor = await assertPermission('payroll.prepare');
    const parsed = csvSchema.safeParse({ periodId: fd.get('periodId'), text: fd.get('text') });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const n = await importInputsCsv(parsed.data.periodId, parsed.data.text, actor.id, await currentIp());
    revalidatePath(`/payroll/periods/${parsed.data.periodId}/inputs`);
    return { message: `Imported ${n} row(s).` };
  } catch (e) {
    return toState(e);
  }
}

export async function clearImportedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission('payroll.prepare');
    const periodId = id.parse(fd.get('periodId'));
    await deleteImportedInputs(periodId, actor.id, await currentIp());
    revalidatePath(`/payroll/periods/${periodId}/inputs`);
    return { message: 'Imported inputs removed.' };
  } catch (e) {
    return toState(e);
  }
}

// ── Runs ────────────────────────────────────────────────────────────────

export async function createRunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let runId: string;
  try {
    const actor = await assertPermission('payroll.prepare');
    const periodId = z.object({ periodId: id }).safeParse(Object.fromEntries(fd));
    if (!periodId.success) return { error: 'Pick a pay period.' };
    const run = await createRun(periodId.data.periodId, actor.id, await currentIp());
    runId = run.id;
  } catch (e) {
    return toState(e);
  }
  revalidatePath('/payroll');
  redirect(`/payroll/runs/${runId}`);
}

async function runAction(
  permission: 'payroll.prepare' | 'payroll.approve',
  fd: FormData,
  fn: (runId: string, actorId: string, ip: string | null) => Promise<string>,
): Promise<ActionState> {
  try {
    const actor = await assertPermission(permission);
    const runId = id.parse(fd.get('runId'));
    const message = await fn(runId, actor.id, await currentIp());
    revalidatePath(`/payroll/runs/${runId}`);
    revalidatePath('/payroll');
    return { message };
  } catch (e) {
    return toState(e);
  }
}

export async function computeRunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction('payroll.prepare', fd, async (runId, actorId, ip) => {
    const t = await computeRun(runId, actorId, ip);
    return t.errors.length
      ? `Computed ${t.headcount} employee(s); ${t.errors.length} could not be calculated.`
      : `Computed ${t.headcount} employee(s).`;
  });
}

export async function submitRunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction('payroll.prepare', fd, async (runId, actorId, ip) => {
    await submitRun(runId, actorId, ip);
    return 'Submitted for approval.';
  });
}

export async function approveRunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction('payroll.approve', fd, async (runId, actorId, ip) => {
    await approveRun(runId, actorId, ip);
    return 'Run approved.';
  });
}

const commentSchema = z
  .string()
  .trim()
  .min(5, 'Give a reason for rejecting (at least 5 characters)')
  .max(2_000);

export async function rejectRunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction('payroll.approve', fd, async (runId, actorId, ip) => {
    const comment = commentSchema.safeParse(fd.get('comment'));
    if (!comment.success) throw new RunActionError(comment.error.issues[0]?.message ?? 'Invalid comment');
    await rejectRun(runId, actorId, comment.data, ip);
    return 'Run rejected and returned for correction.';
  });
}

export async function deleteRunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await assertPermission('payroll.prepare');
    const runId = id.parse(fd.get('runId'));
    await deleteRun(runId, actor.id, await currentIp());
  } catch (e) {
    return toState(e);
  }
  revalidatePath('/payroll');
  redirect('/payroll');
}
