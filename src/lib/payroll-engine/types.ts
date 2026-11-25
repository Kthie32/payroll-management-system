import { z } from 'zod';
import type { Bp, Ugx } from '@/lib/money';

export type { Bp, Ugx };
export type IsoDate = string;

export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
export type CalcType = 'FIXED' | 'PERCENT_OF_BASIC' | 'RATE_X_QTY';
export type Residency = 'RESIDENT' | 'NON_RESIDENT';
export type LineKind = 'EARNING' | 'STATUTORY' | 'DEDUCTION' | 'EMPLOYER';

/** The component code that identifies basic pay (used by PERCENT_OF_BASIC). */
export const BASIC_CODE = 'BASIC';

/** Line codes produced by the engine for statutory items. */
export const LINE_CODES = {
  PAYE: 'PAYE',
  NSSF_EMPLOYEE: 'NSSF_EE',
  NSSF_EMPLOYER: 'NSSF_ER',
  LST: 'LST',
} as const;

/** Warning codes. Some carry a `:<detail>` suffix (e.g. `COMPONENT_MISSING_VALUE:BONUS`). */
export const WARNINGS = {
  LST_RULE_MISSING: 'LST_RULE_MISSING',
  LST_SHORTFALL: 'LST_SHORTFALL',
  PAYE_OVERWITHHELD: 'PAYE_OVERWITHHELD',
  PAYE_SHORTFALL: 'PAYE_SHORTFALL',
  DEDUCTIONS_CARRIED_FORWARD: 'DEDUCTIONS_CARRIED_FORWARD',
  COMPONENT_MISSING_VALUE: 'COMPONENT_MISSING_VALUE',
  NO_DAYS_WORKED: 'NO_DAYS_WORKED',
} as const;

// ───────────────────────── zod building blocks ─────────────────────────

const ugx = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const month = z.number().int().min(1).max(12); // engine-constants-allow: calendar months 1–12

// ───────────────────────── Statutory params ─────────────────────────

/** Bands must start at 0, be contiguous and ascending, and the last must be open-ended. */
function contiguousBands(bands: Array<{ from: number; to: number | null }>): boolean {
  if (bands.length === 0) return true;
  if (bands[0]!.from !== 0) return false;
  for (let i = 0; i < bands.length - 1; i++) {
    const band = bands[i]!;
    if (band.to === null || band.to <= band.from) return false;
    if (bands[i + 1]!.from !== band.to) return false;
  }
  return bands[bands.length - 1]!.to === null;
}

export const payeParamsSchema = z.object({
  bands: z
    .array(z.object({ from: ugx, to: ugx.nullable(), rateBp: bp }))
    .min(1)
    .refine(contiguousBands, 'PAYE bands must start at 0, be contiguous and end open-ended'),
  surcharge: z.object({ threshold: ugx, rateBp: bp }).nullable(),
});
export type PayeParams = z.infer<typeof payeParamsSchema>;

export const nssfParamsSchema = z.object({
  employeeRateBp: bp,
  employerRateBp: bp,
  ceiling: ugx.nullable(),
});
export type NssfParams = z.infer<typeof nssfParamsSchema>;

export const lstParamsSchema = z.object({
  bands: z
    .array(z.object({ from: ugx, to: ugx.nullable(), annual: ugx }))
    .refine(contiguousBands, 'LST bands must start at 0, be contiguous and end open-ended'),
  instalments: z.number().int().positive(),
  months: z.array(month).min(1),
  basis: z.literal('MONTHLY_GROSS'),
});
export type LstParams = z.infer<typeof lstParamsSchema>;

// ───────────────────────── Engine input ─────────────────────────

/** Quantities allow at most two decimals (e.g. 1.5 overtime hours). */
const quantity = z
  .number()
  .nonnegative()
  .refine((q) => /^\d+(\.\d{1,2})?$/.test(String(q)), 'quantity allows at most two decimals');

export const engineComponentSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional(),
  kind: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER']),
  calcType: z.enum(['FIXED', 'PERCENT_OF_BASIC', 'RATE_X_QTY']),
  amount: ugx.optional(),
  rateBp: bp.optional(),
  ratePerUnit: ugx.optional(),
  quantity: quantity.optional(),
  taxable: z.boolean(),
  nssfable: z.boolean(),
  prorate: z.boolean(),
  priority: z.number().int(),
});
export type EngineComponent = z.infer<typeof engineComponentSchema>;

export const engineInputSchema = z.object({
  period: z.object({
    start: isoDate,
    end: isoDate,
    payDate: isoDate,
    frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']),
    isLastCycleOfMonth: z.boolean(),
  }),
  employee: z.object({
    id: z.string().min(1),
    residency: z.enum(['RESIDENT', 'NON_RESIDENT']),
    hireDate: isoDate,
    exitDate: isoDate.nullable(),
    payeApplicable: z.boolean(),
    nssfApplicable: z.boolean(),
    lstApplicable: z.boolean(),
  }),
  components: z.array(engineComponentSchema),
  monthToDate: z.object({ taxable: ugx, payeWithheld: ugx, gross: ugx }),
  carryForward: z.array(
    z.object({ code: z.string().min(1), amount: ugx, priority: z.number().int().optional() }),
  ),
  rules: z.object({
    paye: payeParamsSchema.nullable(),
    nssf: nssfParamsSchema,
    lst: lstParamsSchema.nullable(),
    /**
     * Months in which LST is collected, taken from the latest LST rule version even when it is
     * not active. Lets the engine warn `LST_RULE_MISSING` only in LST months. If omitted and
     * `lst` is null, the engine warns on every last cycle of a month.
     */
    lstMonths: z.array(month).optional(),
  }),
  settings: z.object({ minNetPayBp: bp }),
});
export type EngineInput = z.infer<typeof engineInputSchema>;

export interface EngineLine {
  code: string;
  kind: LineKind;
  quantity: number | null;
  rate: number | null;
  amount: Ugx;
  note: string;
}

export interface CarryForwardItem {
  code: string;
  amount: Ugx;
}

export interface EngineResult {
  lines: EngineLine[];
  gross: Ugx;
  taxable: Ugx;
  nssfBase: Ugx;
  paye: Ugx;
  nssfEmployee: Ugx;
  nssfEmployer: Ugx;
  lst: Ugx;
  otherDeductions: Ugx;
  net: Ugx;
  employerCost: Ugx;
  carryForward: CarryForwardItem[];
  warnings: string[];
}
