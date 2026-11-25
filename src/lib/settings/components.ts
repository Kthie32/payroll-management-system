import { z } from 'zod';

/** Codes the engine emits for statutory lines; pay components must not reuse them. */
export const RESERVED_COMPONENT_CODES = ['PAYE', 'NSSF_EE', 'NSSF_ER', 'LST'] as const;

export const componentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Code: 2–40 characters, letters, digits and _ (start with a letter)')
  .refine(
    (c) => !(RESERVED_COMPONENT_CODES as readonly string[]).includes(c),
    'That code is reserved for statutory lines',
  );

const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal(''), z.null(), z.undefined()])
  .transform((v) => v === 'on' || v === 'true');

export const componentFieldsSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    kind: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER']),
    calcType: z.enum(['FIXED', 'PERCENT_OF_BASIC', 'RATE_X_QTY']),
    taxable: checkbox,
    nssfable: checkbox,
    prorate: checkbox,
    recurring: checkbox,
    isActive: checkbox,
    priority: z.coerce.number().int().min(0).max(9999),
    sortOrder: z.coerce.number().int().min(0).max(9999),
  })
  .transform((c) =>
    // Taxability and NSSF only apply to earnings.
    c.kind === 'EARNING' ? c : { ...c, taxable: false, nssfable: false },
  );

export type ComponentFields = z.output<typeof componentFieldsSchema>;

export const KIND_LABELS = { EARNING: 'Earning', DEDUCTION: 'Deduction', EMPLOYER: 'Employer cost' };
export const CALC_LABELS = {
  FIXED: 'Fixed amount',
  PERCENT_OF_BASIC: '% of basic',
  RATE_X_QTY: 'Rate × quantity',
};

export const FREQUENCY_LABELS = {
  MONTHLY: 'Monthly',
  FORTNIGHTLY: 'Fortnightly',
  WEEKLY: 'Weekly',
} as const;
