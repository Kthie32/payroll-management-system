import { z } from 'zod';
import type { Tx } from '@/lib/db';
import type { Bp } from '@/lib/money';

/** Setting keys stored in the `settings` table. */
export const SETTING_KEYS = {
  minNetPayBp: 'minNetPayBp',
  prorationBasis: 'prorationBasis',
  companyName: 'company.name',
  companyTin: 'company.tin',
  companyNssfEmployerNo: 'company.nssfEmployerNo',
  companyAddress: 'company.address',
  payslipFooter: 'payslip.footer',
} as const;

export const PRORATION_BASES = ['CALENDAR_DAYS', 'WORKING_DAYS', 'FIXED_30'] as const;
export type ProrationBasis = (typeof PRORATION_BASES)[number];
/** Only calendar days are implemented by the engine today. */
export const SUPPORTED_PRORATION_BASES: readonly ProrationBasis[] = ['CALENDAR_DAYS'];

export interface CompanyDetails {
  name: string;
  tin: string;
  nssfEmployerNo: string;
  address: string;
}

export interface AppSettings {
  minNetPayBp: Bp;
  prorationBasis: ProrationBasis;
  company: CompanyDetails;
  payslipFooter: string;
}

const bpValue = z.number().int().min(0).max(10_000);

/** Turn raw key/value rows into typed settings, with safe defaults for anything missing. */
export function settingsFromRows(rows: readonly { key: string; value: unknown }[]): AppSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const str = (key: string) => {
    const v = map.get(key);
    return typeof v === 'string' ? v : '';
  };
  const minNet = bpValue.safeParse(map.get(SETTING_KEYS.minNetPayBp));
  const basis = z.enum(PRORATION_BASES).safeParse(map.get(SETTING_KEYS.prorationBasis));
  return {
    minNetPayBp: minNet.success ? minNet.data : 0,
    prorationBasis: basis.success ? basis.data : 'CALENDAR_DAYS',
    company: {
      name: str(SETTING_KEYS.companyName),
      tin: str(SETTING_KEYS.companyTin),
      nssfEmployerNo: str(SETTING_KEYS.companyNssfEmployerNo),
      address: str(SETTING_KEYS.companyAddress),
    },
    payslipFooter: str(SETTING_KEYS.payslipFooter),
  };
}

/** Typed application settings. */
export async function getSettings(tx: Pick<Tx, 'setting'>): Promise<AppSettings> {
  const rows = await tx.setting.findMany({
    where: { key: { in: Object.values(SETTING_KEYS) } },
    select: { key: true, value: true },
  });
  return settingsFromRows(rows);
}
