/** Message wording for payslip delivery. Pure. */

export interface PayslipMessageArgs {
  companyName: string;
  firstName: string;
  /** e.g. "November 2026". */
  periodLabel: string;
  link: string;
  /** e.g. "2 Dec 2026". */
  expiresOn: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function payslipEmail(a: PayslipMessageArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Your payslip for ${a.periodLabel} – ${a.companyName}`;
  const text = [
    `Dear ${a.firstName},`,
    '',
    `Your payslip for ${a.periodLabel} is attached as a PDF.`,
    `You can also view it online until ${a.expiresOn}: ${a.link}`,
    'You will be asked to confirm the last 4 digits of your phone number or your staff number.',
    '',
    'If anything looks wrong, please contact the payroll office. Do not share this link.',
    '',
    a.companyName,
  ].join('\n');
  const html = `<p>Dear ${escapeHtml(a.firstName)},</p>
<p>Your payslip for <strong>${escapeHtml(a.periodLabel)}</strong> is attached as a PDF.</p>
<p>You can also <a href="${escapeHtml(a.link)}">view it online</a> until ${escapeHtml(a.expiresOn)}. You will be asked to confirm the last 4 digits of your phone number or your staff number.</p>
<p>If anything looks wrong, please contact the payroll office. Do not share this link.</p>
<p>${escapeHtml(a.companyName)}</p>`;
  return { subject, text, html };
}

/** A short SMS (one or two segments). */
export function payslipSms(a: PayslipMessageArgs): string {
  return `${a.companyName}: your ${a.periodLabel} payslip is ready. View until ${a.expiresOn}: ${a.link}`;
}

/** Replaces the secret part of any payslip link with dots, for storing a copy of the message. */
export function redactLinks(text: string): string {
  return text.replace(/(\/p\/)[A-Za-z0-9_-]{16,}/g, '$1••••••••');
}
