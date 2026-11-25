import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { withAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { messagingConfig, sendMessage, type Channel } from '@/lib/messaging';
import { payslipEmail, payslipSms } from '@/lib/messaging/templates';
import { formatIsoDate, monthLabel, toIsoDate } from '../dates';
import { PayslipDocument } from '../payslip-pdf';
import { hashLinkToken, looksLikeToken, MAX_VERIFY_ATTEMPTS, newLinkToken } from '../payslip-links';
import { isPosted, type RunStatus } from '../status';
import { RunActionError } from './errors';
import { loadPayslips } from './payslips';

const MS_PER_DAY = 86_400_000;
const PHONE_RE = /^256\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalises a Ugandan mobile number to 2567XXXXXXXX, or null if it is not one. */
export function normalisePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 10) d = `256${d.slice(1)}`;
  return PHONE_RE.test(d) ? d : null;
}

export interface SendSummary {
  sent: number;
  failed: number;
  skipped: Array<{ staffNo: string; name: string; reason: string }>;
}

/**
 * Sends payslips for an approved (or later) run by email (PDF attached + link) and/or SMS (link).
 * Each message gets its own single-use-per-recipient link token; only its hash is stored.
 * Employees without an email/phone are reported as skipped. Audited with counts only.
 */
export async function sendPayslips(
  runId: string,
  opts: { employeeIds: string[] | null; channels: Channel[] },
  actorId: string,
  ip: string | null,
): Promise<SendSummary> {
  if (opts.channels.length === 0) throw new RunActionError('Choose email, SMS or both.');
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) throw new RunActionError('Run not found.');
  if (!isPosted(run.status as RunStatus)) {
    throw new RunActionError('Payslips can only be sent once the run is approved.');
  }
  const config = messagingConfig();
  const slips = (await loadPayslips(runId)).filter(
    (p) => !opts.employeeIds || opts.employeeIds.includes(p.employeeId),
  );
  if (slips.length === 0) throw new RunActionError('No payslips selected.');

  const [employees, runEmployees] = await Promise.all([
    db.employee.findMany({
      where: { id: { in: slips.map((p) => p.employeeId) } },
      select: { id: true, firstName: true, email: true, phone: true },
    }),
    db.payrollRunEmployee.findMany({
      where: { runId, employeeId: { in: slips.map((p) => p.employeeId) } },
      select: { id: true, employeeId: true },
    }),
  ]);
  const empBy = new Map(employees.map((e) => [e.id, e]));
  const reBy = new Map(runEmployees.map((r) => [r.employeeId, r.id]));

  const summary: SendSummary = { sent: 0, failed: 0, skipped: [] };
  const expiresAt = new Date(Date.now() + config.linkDays * MS_PER_DAY);
  const expiresOn = formatIsoDate(toIsoDate(expiresAt));

  for (const p of slips) {
    const emp = empBy.get(p.employeeId);
    const runEmployeeId = reBy.get(p.employeeId);
    if (!emp || !runEmployeeId) continue;
    for (const channel of opts.channels) {
      const to =
        channel === 'EMAIL'
          ? emp.email && EMAIL_RE.test(emp.email.trim())
            ? emp.email.trim()
            : null
          : normalisePhone(emp.phone);
      if (!to) {
        summary.skipped.push({
          staffNo: p.employee.staffNo,
          name: p.employee.name,
          reason: channel === 'EMAIL' ? 'No valid email address' : 'No valid mobile number',
        });
        continue;
      }
      const token = newLinkToken();
      const delivery = await db.payslipDelivery.create({
        data: {
          runEmployeeId,
          channel,
          recipient: to,
          tokenHash: hashLinkToken(token),
          expiresAt,
          createdById: actorId,
        },
      });
      const link = `${config.baseUrl}/p/${token}`;
      const args = {
        companyName: p.company.name || 'Payroll',
        firstName: emp.firstName,
        periodLabel: monthLabel(p.period.payDate.slice(0, 7)),
        link,
        expiresOn,
      };
      let message;
      if (channel === 'EMAIL') {
        const mail = payslipEmail(args);
        const pdf = await renderToBuffer(
          createElement(PayslipDocument, { payslips: [p] }) as never,
        );
        message = await sendMessage(
          {
            channel,
            to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            attachments: [
              {
                filename: `payslip-${p.employee.staffNo}-${p.period.payDate}.pdf`,
                content: Buffer.from(pdf),
                contentType: 'application/pdf',
              },
            ],
          },
          actorId,
          config,
        );
      } else {
        message = await sendMessage({ channel, to, text: payslipSms(args) }, actorId, config);
      }
      await db.payslipDelivery.update({
        where: { id: delivery.id },
        data: { messageId: message.id },
      });
      if (message.status === 'FAILED') summary.failed++;
      else summary.sent++;
    }
  }

  await db.$transaction((tx) =>
    withAudit(tx, {
      actorId,
      action: 'PAYSLIPS_SENT',
      entity: 'PayrollRun',
      entityId: runId,
      after: {
        channels: opts.channels,
        employees: slips.length,
        sent: summary.sent,
        failed: summary.failed,
        skipped: summary.skipped.length,
        mode: config.mode,
      },
      ip,
    }),
  );
  return summary;
}

/** Latest deliveries per employee for a run (for the delivery status table). */
export async function deliveryStatus(runId: string) {
  const rows = await db.payslipDelivery.findMany({
    where: { runEmployee: { runId } },
    include: {
      message: { select: { status: true, error: true, provider: true, sentAt: true } },
      runEmployee: { select: { employeeId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = by.get(r.runEmployee.employeeId) ?? [];
    list.push(r);
    by.set(r.runEmployee.employeeId, list);
  }
  return by;
}

// ── Public (employee) side ──────────────────────────────────────────────

/** Finds a live delivery for a link token. Returns null for unknown, expired or unposted links. */
export async function findDeliveryByToken(token: string) {
  if (!looksLikeToken(token)) return null;
  const d = await db.payslipDelivery.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    include: {
      runEmployee: {
        select: {
          runId: true,
          employeeId: true,
          run: { select: { status: true } },
          employee: { select: { phone: true, staffNo: true, firstName: true } },
        },
      },
    },
  });
  if (!d || d.expiresAt.getTime() < Date.now()) return null;
  if (!isPosted(d.runEmployee.run.status as RunStatus)) return null;
  return d;
}

/** Failed identity checks for a delivery (append-only audit log is the counter). */
export async function failedAttempts(deliveryId: string): Promise<number> {
  return db.auditLog.count({
    where: {
      entity: 'PayslipDelivery',
      entityId: deliveryId,
      action: 'PAYSLIP_LINK_VERIFY_FAILED',
    },
  });
}

export async function isLinkLocked(deliveryId: string): Promise<boolean> {
  return (await failedAttempts(deliveryId)) >= MAX_VERIFY_ATTEMPTS;
}

export async function recordVerifyFailure(deliveryId: string, ip: string | null) {
  await db.$transaction((tx) =>
    withAudit(tx, {
      actorId: null,
      action: 'PAYSLIP_LINK_VERIFY_FAILED',
      entity: 'PayslipDelivery',
      entityId: deliveryId,
      ip,
    }),
  );
}

export async function recordOpen(deliveryId: string, ip: string | null) {
  await db.$transaction(async (tx) => {
    const d = await tx.payslipDelivery.update({
      where: { id: deliveryId },
      data: { openCount: { increment: 1 } },
    });
    if (!d.openedAt) {
      await tx.payslipDelivery.update({
        where: { id: deliveryId },
        data: { openedAt: new Date() },
      });
    }
    await withAudit(tx, {
      actorId: null,
      action: 'PAYSLIP_LINK_OPENED',
      entity: 'PayslipDelivery',
      entityId: deliveryId,
      after: { openCount: d.openCount },
      ip,
    });
  });
}
