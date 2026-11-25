import type {
  EngineComponent,
  EngineInput,
  LstParams,
  NssfParams,
  PayeParams,
} from '@/lib/payroll-engine';

/** PAYE_RES as seeded (effective 2026-07-01). Test-only copy; the engine never hard-codes it. */
export const PAYE_RES: PayeParams = {
  bands: [
    { from: 0, to: 335_000, rateBp: 0 },
    { from: 335_000, to: 410_000, rateBp: 2000 },
    { from: 410_000, to: 485_000, rateBp: 2500 },
    { from: 485_000, to: null, rateBp: 3000 },
  ],
  surcharge: { threshold: 10_000_000, rateBp: 1000 },
};

export const NSSF: NssfParams = { employeeRateBp: 500, employerRateBp: 1000, ceiling: null };

/** November 2026 MONTHLY period. */
export const NOV_2026 = {
  start: '2026-11-01',
  end: '2026-11-30',
  payDate: '2026-11-28',
  frequency: 'MONTHLY' as const,
  isLastCycleOfMonth: true,
};

export function basic(amount: number, extra: Partial<EngineComponent> = {}): EngineComponent {
  return {
    code: 'BASIC',
    kind: 'EARNING',
    calcType: 'FIXED',
    amount,
    taxable: true,
    nssfable: true,
    prorate: true,
    priority: 0,
    ...extra,
  };
}

export function earning(
  code: string,
  amount: number,
  extra: Partial<EngineComponent> = {},
): EngineComponent {
  return {
    code,
    kind: 'EARNING',
    calcType: 'FIXED',
    amount,
    taxable: true,
    nssfable: true,
    prorate: false,
    priority: 0,
    ...extra,
  };
}

export function deduction(code: string, amount: number, priority: number): EngineComponent {
  return {
    code,
    kind: 'DEDUCTION',
    calcType: 'FIXED',
    amount,
    taxable: false,
    nssfable: false,
    prorate: false,
    priority,
  };
}

export function makeInput(
  overrides: {
    period?: Partial<EngineInput['period']>;
    employee?: Partial<EngineInput['employee']>;
    components?: EngineComponent[];
    monthToDate?: Partial<EngineInput['monthToDate']>;
    carryForward?: EngineInput['carryForward'];
    rules?: Partial<EngineInput['rules']>;
    settings?: Partial<EngineInput['settings']>;
  } = {},
): EngineInput {
  return {
    period: { ...NOV_2026, ...overrides.period },
    employee: {
      id: 'emp-1',
      residency: 'RESIDENT',
      hireDate: '2020-01-01',
      exitDate: null,
      payeApplicable: true,
      nssfApplicable: true,
      lstApplicable: true,
      ...overrides.employee,
    },
    components: overrides.components ?? [basic(1_000_000)],
    monthToDate: { taxable: 0, payeWithheld: 0, gross: 0, ...overrides.monthToDate },
    carryForward: overrides.carryForward ?? [],
    rules: { paye: PAYE_RES, nssf: NSSF, lst: null, lstMonths: [7, 8, 9, 10], ...overrides.rules },
    settings: { minNetPayBp: 0, ...overrides.settings },
  };
}

export type { LstParams };
