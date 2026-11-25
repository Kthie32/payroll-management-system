/**
 * Adjustments: approved runs are never edited (CLAUDE.md, Magezi spec §3). A mistake in an
 * approved run is corrected in a later period with an ARREARS earning (under-payment) or an
 * OVERPAYMENT_RECOVERY deduction (over-payment), each with a mandatory explanation and a link to
 * the run being corrected. Pure helpers only.
 */

export const ADJUSTMENT_CODES = ['ARREARS', 'OVERPAYMENT_RECOVERY'] as const;
export type AdjustmentCode = (typeof ADJUSTMENT_CODES)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentCode, string> = {
  ARREARS: 'Arrears (under-paid earlier — pay the difference)',
  OVERPAYMENT_RECOVERY: 'Overpayment recovery (over-paid earlier — deduct the difference)',
};

export const NOTE_MIN = 5;
export const NOTE_MAX = 300;

export function isAdjustmentCode(code: string): code is AdjustmentCode {
  return (ADJUSTMENT_CODES as readonly string[]).includes(code);
}

export interface AdjustmentDraft {
  componentCode: string;
  amountText: string;
  note: string;
  adjustsRunId: string;
}

export interface ValidAdjustment {
  componentCode: AdjustmentCode;
  amount: number;
  note: string;
  adjustsRunId: string;
}

/** Validates a manually entered adjustment. Returns the parsed value or a list of errors. */
export function validateAdjustment(
  d: AdjustmentDraft,
): { ok: true; value: ValidAdjustment } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const code = d.componentCode.trim().toUpperCase();
  if (!isAdjustmentCode(code)) errors.push('Choose arrears or overpayment recovery.');
  const amountText = d.amountText.trim().replace(/,/g, '');
  const amount = Number(amountText);
  if (!/^\d+$/.test(amountText) || !Number.isSafeInteger(amount) || amount <= 0) {
    errors.push('Enter the amount in whole shillings, greater than zero.');
  }
  const note = d.note.trim().replace(/\s+/g, ' ');
  if (note.length < NOTE_MIN) errors.push('Explain the correction (at least 5 characters).');
  if (note.length > NOTE_MAX) errors.push(`Keep the explanation under ${NOTE_MAX} characters.`);
  if (!d.adjustsRunId.trim()) errors.push('Choose the approved run being corrected.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      componentCode: code as AdjustmentCode,
      amount,
      note,
      adjustsRunId: d.adjustsRunId.trim(),
    },
  };
}
