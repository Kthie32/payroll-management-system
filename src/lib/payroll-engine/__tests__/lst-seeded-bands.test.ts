import { describe, expect, it } from 'vitest';
import { lstInstalment, lstParamsSchema } from '@/lib/payroll-engine';
import seeded from '../../../../prisma/data/lst-bands.json';

// The seeded Uganda LST schedule (prisma/data/lst-bands.json), as the Finance Approver will see it.
const params = lstParamsSchema.parse({
  bands: seeded.bands,
  instalments: 4,
  months: [7, 8, 9, 10],
  basis: 'MONTHLY_GROSS',
});

const base = {
  params,
  payDate: '2026-08-31',
  isLastCycleOfMonth: true,
  applicable: true,
  monthlyGross: 0,
} as const;

describe('seeded Uganda LST schedule', () => {
  it.each([
    [100_000, 0],
    [100_001, 1_250],
    [200_000, 1_250],
    [200_001, 2_500],
    [400_000, 5_000],
    [600_001, 15_000],
    [1_000_000, 22_500],
    [1_000_001, 25_000],
    [12_000_000, 25_000],
  ])('monthly gross %i → instalment %i (annual ÷ 4)', (gross, instalment) => {
    expect(lstInstalment({ ...base, monthlyGross: gross }).amount).toBe(instalment);
  });

  it('is not deducted outside July–October', () => {
    expect(lstInstalment({ ...base, payDate: '2026-11-30', monthlyGross: 1_000_000 }).amount).toBe(
      0,
    );
  });
});
