import { assertUgx, mulBp } from '@/lib/money';
import type { NssfParams, Ugx } from './types';

export interface NssfArgs {
  params: NssfParams;
  /** Sum of NSSF-able earnings for the period. */
  base: Ugx;
  applicable: boolean;
}

export interface NssfResult {
  /** Base actually used (after the ceiling, if any). */
  base: Ugx;
  employee: Ugx;
  employer: Ugx;
}

/** NSSF contributions. Each side is rounded half-up once. Zero when not applicable. */
export function nssf({ params, base, applicable }: NssfArgs): NssfResult {
  assertUgx(base, 'NSSF base');
  if (!applicable) return { base: 0, employee: 0, employer: 0 };
  const capped = params.ceiling === null ? base : Math.min(base, params.ceiling);
  return {
    base: capped,
    employee: mulBp(capped, params.employeeRateBp),
    employer: mulBp(capped, params.employerRateBp),
  };
}
