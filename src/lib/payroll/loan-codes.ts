/**
 * Loan deductions are passed to the engine with a per-loan code `<COMPONENT>#<loanId>` so the
 * amount actually deducted for each loan can be traced back on approval.
 */
const SEP = '#';

export function loanLineCode(componentCode: string, loanId: string): string {
  return `${componentCode}${SEP}${loanId}`;
}

export function parseLoanLineCode(code: string): { componentCode: string; loanId: string } | null {
  const i = code.indexOf(SEP);
  if (i <= 0 || i === code.length - 1) return null;
  return { componentCode: code.slice(0, i), loanId: code.slice(i + 1) };
}

/** The component code to display for a line (strips the loan suffix). */
export function displayCode(code: string): string {
  return parseLoanLineCode(code)?.componentCode ?? code;
}

/** Sums deducted amounts per loan from engine/payroll lines. */
export function loanRepaymentsFromLines(
  lines: Array<{ code: string; kind: string; amount: number }>,
): Array<{ loanId: string; amount: number }> {
  const byLoan = new Map<string, number>();
  for (const line of lines) {
    if (line.kind !== 'DEDUCTION') continue;
    const parsed = parseLoanLineCode(line.code);
    if (!parsed || line.amount <= 0) continue;
    byLoan.set(parsed.loanId, (byLoan.get(parsed.loanId) ?? 0) + line.amount);
  }
  return [...byLoan].map(([loanId, amount]) => ({ loanId, amount }));
}
