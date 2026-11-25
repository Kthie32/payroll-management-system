import type { LstParams } from '@/lib/payroll-engine';

/**
 * FIXTURE ONLY — illustrative LST bands for tests. These are NOT the statutory bands;
 * real bands live in prisma/data/lst-bands.json once confirmed.
 * 1,000,000 falls in the 30,002 band so annual ÷ 4 = 7,500.5 exercises half-up rounding.
 */
export const LST_FIXTURE: LstParams = {
  bands: [
    { from: 0, to: 100_000, annual: 0 },
    { from: 100_000, to: 500_000, annual: 10_000 },
    { from: 500_000, to: 2_000_000, annual: 30_002 },
    { from: 2_000_000, to: null, annual: 100_000 },
  ],
  instalments: 4,
  months: [7, 8, 9, 10],
  basis: 'MONTHLY_GROSS',
};
