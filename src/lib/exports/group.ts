import type { Ugx } from '@/lib/money';

/** A run employee with their active bank account (if any), before decryption. */
export interface PayeeInput {
  employeeId: string;
  staffNo: string;
  employeeName: string;
  net: Ugx;
  account: {
    bankId: string;
    bankName: string;
    bankCode: string;
    branchCode: string | null;
    accountName: string;
    accountNoEnc: string;
    accountNoLast4: string;
  } | null;
}

export interface BankGroup {
  bankId: string;
  bankName: string;
  bankCode: string;
  payees: PayeeInput[];
  total: Ugx;
}

export interface PaymentPlan {
  groups: BankGroup[];
  /** Employees with net pay but no active bank account — they block export. */
  missingAccounts: PayeeInput[];
  /** Employees with zero net pay — nothing to pay, excluded from bank files. */
  zeroNet: PayeeInput[];
  /** Sum of net pay for everyone in the run. */
  runNetTotal: Ugx;
}

/** Group payees by the bank of their active account. Groups and payees are sorted for stable files. */
export function planPayments(payees: readonly PayeeInput[]): PaymentPlan {
  const groups = new Map<string, BankGroup>();
  const missingAccounts: PayeeInput[] = [];
  const zeroNet: PayeeInput[] = [];
  let runNetTotal = 0;

  for (const p of payees) {
    runNetTotal += p.net;
    if (p.net === 0) {
      zeroNet.push(p);
      continue;
    }
    if (!p.account) {
      missingAccounts.push(p);
      continue;
    }
    let g = groups.get(p.account.bankId);
    if (!g) {
      g = {
        bankId: p.account.bankId,
        bankName: p.account.bankName,
        bankCode: p.account.bankCode,
        payees: [],
        total: 0,
      };
      groups.set(p.account.bankId, g);
    }
    g.payees.push(p);
    g.total += p.net;
  }

  const byStaff = (a: PayeeInput, b: PayeeInput) => a.staffNo.localeCompare(b.staffNo);
  const sorted = [...groups.values()].sort((a, b) => a.bankName.localeCompare(b.bankName));
  for (const g of sorted) g.payees.sort(byStaff);
  missingAccounts.sort(byStaff);
  zeroNet.sort(byStaff);
  return { groups: sorted, missingAccounts, zeroNet, runNetTotal };
}

/** True when every bank with payees has a current export and nobody is missing an account. */
export function readyToMarkExported(
  plan: PaymentPlan,
  currentExportBankIds: ReadonlySet<string>,
): boolean {
  if (plan.missingAccounts.length > 0) return false;
  return plan.groups.every((g) => currentExportBankIds.has(g.bankId));
}
