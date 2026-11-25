'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import {
  addBankAccount,
  assignComponent,
  changeStatus,
  createEmployee,
  EmployeeError,
  endComponent,
  updateEmployee,
} from '@/lib/employees/service';
import {
  bankAccountSchema,
  componentAssignmentSchema,
  componentValueFor,
  employeeFormSchema,
  employeeFormValues,
  exitSchema,
  isoDateSchema,
} from '@/lib/employees/validation';
import { assertPermission } from '@/lib/rbac';

export interface ActionState {
  error?: string;
  message?: string;
  /** Field-level errors, keyed by form field name. */
  fieldErrors?: Record<string, string>;
  /** The submitted values, so the form can refill itself after React resets it. */
  values?: Record<string, string>;
}

function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && k !== 'nin') out[k] = v;
  return out;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

async function actor() {
  const user = await assertPermission('employees.edit');
  return { id: user.id, ip: await currentIp() };
}

/** Runs a write and turns EmployeeError into a form error. */
async function attempt(fn: () => Promise<void>): Promise<ActionState | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof EmployeeError) return { error: e.message };
    throw e;
  }
}

// ── Create / update ─────────────────────────────────────────────────────

export async function createEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const who = await actor();
  const parsed = employeeFormSchema.safeParse(employeeFormValues(formData));
  if (!parsed.success) {
    return {
      error: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error),
      values: formValues(formData),
    };
  }
  let id = '';
  const failed = await attempt(async () => {
    const e = await db.$transaction((tx) => createEmployee(tx, parsed.data, who));
    id = e.id;
  });
  if (failed) return { ...failed, values: formValues(formData) };
  revalidatePath('/employees');
  redirect(`/employees/${id}?created=1`);
}

export async function updateEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const who = await actor();
  const employeeId = String(formData.get('employeeId') ?? '');
  if (!employeeId) return { error: 'Missing employee.' };
  const parsed = employeeFormSchema.safeParse(employeeFormValues(formData));
  if (!parsed.success) {
    return {
      error: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error),
      values: formValues(formData),
    };
  }
  const failed = await attempt(async () => {
    await db.$transaction((tx) => updateEmployee(tx, employeeId, parsed.data, who));
  });
  if (failed) return { ...failed, values: formValues(formData) };
  revalidatePath('/employees');
  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}?saved=1`);
}

// ── Status ──────────────────────────────────────────────────────────────

const statusSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('suspend'), employeeId: z.string().min(1) }),
  z.object({ intent: z.literal('reactivate'), employeeId: z.string().min(1) }),
  exitSchema.extend({ intent: z.literal('exit') }),
]);

export async function changeStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const who = await actor();
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  const input = parsed.data;
  const change =
    input.intent === 'exit'
      ? ({ kind: 'exit', exitDate: input.exitDate } as const)
      : ({ kind: input.intent } as const);
  const failed = await attempt(async () => {
    await db.$transaction((tx) => changeStatus(tx, input.employeeId, change, who));
  });
  if (failed) return { ...failed, values: formValues(formData) };
  revalidatePath('/employees');
  revalidatePath(`/employees/${input.employeeId}`);
  const messages = {
    exit: 'Employee exited.',
    suspend: 'Employee suspended.',
    reactivate: 'Employee reactivated.',
  };
  return { message: messages[input.intent] };
}

// ── Bank accounts ───────────────────────────────────────────────────────

export async function addBankAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const who = await actor();
  const parsed = bankAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error),
      values: formValues(formData),
    };
  }
  const failed = await attempt(async () => {
    await db.$transaction((tx) => addBankAccount(tx, parsed.data, who));
  });
  if (failed) return { ...failed, values: formValues(formData) };
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { message: 'Bank account added and set as the active account.' };
}

export interface RevealState {
  error?: string;
  accountNo?: string;
}

/** Shows a full account number to an editor. Every reveal is audited. */
export async function revealAccountAction(
  _prev: RevealState,
  formData: FormData,
): Promise<RevealState> {
  const who = await actor();
  const accountId = String(formData.get('accountId') ?? '');
  const account = await db.employeeBankAccount.findUnique({
    where: { id: accountId },
    select: { id: true, employeeId: true, accountNoEnc: true, accountNoLast4: true },
  });
  if (!account) return { error: 'Account not found.' };
  const accountNo = decrypt(account.accountNoEnc);
  await db.$transaction((tx) =>
    withAudit(tx, {
      actorId: who.id,
      action: 'BANK_ACCOUNT_REVEALED',
      entity: 'EmployeeBankAccount',
      entityId: account.id,
      after: { employeeId: account.employeeId, last4: account.accountNoLast4 },
      ip: who.ip,
    }),
  );
  return { accountNo };
}

// ── Pay components ──────────────────────────────────────────────────────

export async function assignComponentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const who = await actor();
  const parsed = componentAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrors(parsed.error),
      values: formValues(formData),
    };
  }
  const component = await db.payComponent.findUnique({
    where: { id: parsed.data.componentId },
    select: { calcType: true },
  });
  if (!component) return { error: 'Pay component not found.' };
  const value = componentValueFor(component.calcType, parsed.data.value);
  if (!value.ok) {
    return { error: value.error, fieldErrors: { value: value.error }, values: formValues(formData) };
  }

  const failed = await attempt(async () => {
    await db.$transaction((tx) =>
      assignComponent(
        tx,
        {
          employeeId: parsed.data.employeeId,
          componentId: parsed.data.componentId,
          value: value.value,
          effectiveFrom: parsed.data.effectiveFrom,
          effectiveTo: parsed.data.effectiveTo,
        },
        who,
      ),
    );
  });
  if (failed) return { ...failed, values: formValues(formData) };
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { message: 'Component assigned.' };
}

const endSchema = z.object({
  assignmentId: z.string().min(1),
  employeeId: z.string().min(1),
  effectiveTo: isoDateSchema,
});

export async function endComponentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const who = await actor();
  const parsed = endSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  const failed = await attempt(async () => {
    await db.$transaction((tx) =>
      endComponent(tx, parsed.data.assignmentId, parsed.data.effectiveTo, who),
    );
  });
  if (failed) return { ...failed, values: formValues(formData) };
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { message: 'End date set.' };
}
