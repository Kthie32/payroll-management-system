import { formatUgx } from '@/lib/money';
import { applyDeductions, type DeductionRequest } from './deductions';
import { componentAmount, computeEarnings } from './earnings';
import { InvalidInputError, MissingRuleError } from './errors';
import { lstInstalment } from './lst';
import { nssf } from './nssf';
import { payeCumulative, payeMonthly } from './paye';
import {
  engineInputSchema,
  LINE_CODES,
  WARNINGS,
  type EngineInput,
  type EngineLine,
  type EngineResult,
} from './types';

function validate(input: unknown): EngineInput {
  const parsed = engineInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidInputError(
      'Invalid engine input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return parsed.data;
}

/**
 * Calculates one employee's pay for one period. Pure and deterministic.
 * Order: earnings → NSSF → PAYE → LST → other deductions → net → employer cost.
 * See CLAUDE.md "Calculation order".
 */
export function calculateEmployee(rawInput: EngineInput): EngineResult {
  const input = validate(rawInput);
  const { period, employee, rules, monthToDate } = input;
  const warnings: string[] = [];

  // 1–2. Earnings, gross, taxable, NSSF base
  const earnings = computeEarnings(input);
  warnings.push(...earnings.warnings);
  const { gross, taxable } = earnings;

  // 3. NSSF
  const contributions = nssf({
    params: rules.nssf,
    base: earnings.nssfBase,
    applicable: employee.nssfApplicable,
  });
  const nssfNote = employee.nssfApplicable
    ? `${formatUgx(contributions.base)} NSSF base`
    : 'NSSF not applicable for this employee (nssfApplicable = false)';

  // 4. PAYE
  let paye = 0;
  let payeNote: string;
  if (!employee.payeApplicable) {
    payeNote = 'PAYE not applicable for this employee (payeApplicable = false)';
  } else if (rules.paye === null) {
    throw new MissingRuleError(
      employee.residency === 'RESIDENT' ? 'PAYE_RES' : 'PAYE_NONRES',
      `employee ${employee.id}`,
    );
  } else if (period.frequency === 'MONTHLY') {
    paye = payeMonthly(rules.paye, taxable);
    payeNote = `Monthly PAYE on taxable pay ${formatUgx(taxable)}`;
  } else {
    const cumulative = payeCumulative({
      params: rules.paye,
      mtdTaxable: monthToDate.taxable,
      mtdPayeWithheld: monthToDate.payeWithheld,
      taxable,
    });
    paye = cumulative.paye;
    payeNote =
      `Cumulative PAYE: month tax ${formatUgx(cumulative.monthTotal)} on ` +
      `${formatUgx(monthToDate.taxable + taxable)} less ${formatUgx(monthToDate.payeWithheld)} already withheld`;
    if (cumulative.overwithheld) warnings.push(WARNINGS.PAYE_OVERWITHHELD);
  }
  const availableForPaye = gross - contributions.employee;
  if (paye > availableForPaye) {
    payeNote += `; limited to available pay (${formatUgx(paye - availableForPaye)} not withheld)`;
    paye = availableForPaye;
    warnings.push(WARNINGS.PAYE_SHORTFALL);
  }

  // 5. LST
  const lstResult = lstInstalment({
    params: rules.lst,
    fallbackMonths: rules.lstMonths,
    payDate: period.payDate,
    isLastCycleOfMonth: period.isLastCycleOfMonth,
    applicable: employee.lstApplicable,
    monthlyGross: monthToDate.gross + gross,
  });
  if (lstResult.warning) warnings.push(lstResult.warning);
  let lst = lstResult.amount;
  let lstNote = lstResult.note;
  const availableForLst = gross - contributions.employee - paye;
  if (lst > availableForLst) {
    lstNote += `; limited to available pay (${formatUgx(lst - availableForLst)} not deducted)`;
    lst = availableForLst;
    warnings.push(WARNINGS.LST_SHORTFALL);
  }

  // 6. Other deductions (carry-forward first, then by priority)
  const deductionComponents = input.components.filter((c) => c.kind === 'DEDUCTION');
  const deductionRequests: DeductionRequest[] = [];
  for (const component of deductionComponents) {
    const value = componentAmount(component, earnings.basic);
    if (value.warning) warnings.push(value.warning);
    deductionRequests.push({
      code: component.code,
      amount: value.amount,
      priority: component.priority,
    });
  }
  const priorityByCode = new Map(deductionComponents.map((c) => [c.code, c.priority]));
  const netBeforeDeductions = gross - paye - contributions.employee - lst;
  const deductions = applyDeductions({
    netBeforeDeductions,
    gross,
    minNetPayBp: input.settings.minNetPayBp,
    carryForward: input.carryForward.map((cf) => ({
      code: cf.code,
      amount: cf.amount,
      priority: cf.priority ?? priorityByCode.get(cf.code) ?? 0,
    })),
    deductions: deductionRequests,
  });
  if (deductions.carryForward.length > 0) warnings.push(WARNINGS.DEDUCTIONS_CARRIED_FORWARD);

  // Employer-only components
  const employerLines: EngineLine[] = input.components
    .filter((c) => c.kind === 'EMPLOYER')
    .map((component) => {
      const value = componentAmount(component, earnings.basic);
      if (value.warning) warnings.push(value.warning);
      return {
        code: component.code,
        kind: 'EMPLOYER',
        quantity: value.quantity,
        rate: value.rate,
        amount: value.amount,
        note: `${value.note} (employer cost)`,
      };
    });
  const employerExtras = employerLines.reduce((sum, l) => sum + l.amount, 0);

  // 7. Totals
  const net = netBeforeDeductions - deductions.total;
  const employerCost = gross + contributions.employer + employerExtras;

  const lines: EngineLine[] = [
    ...earnings.lines,
    {
      code: LINE_CODES.PAYE,
      kind: 'STATUTORY',
      quantity: null,
      rate: null,
      amount: paye,
      note: payeNote,
    },
    {
      code: LINE_CODES.NSSF_EMPLOYEE,
      kind: 'STATUTORY',
      quantity: null,
      rate: employee.nssfApplicable ? rules.nssf.employeeRateBp : null,
      amount: contributions.employee,
      note: nssfNote,
    },
    {
      code: LINE_CODES.LST,
      kind: 'STATUTORY',
      quantity: null,
      rate: null,
      amount: lst,
      note: lstNote,
    },
    ...deductions.applied.map((d): EngineLine => ({
      code: d.code,
      kind: 'DEDUCTION',
      quantity: null,
      rate: null,
      amount: d.amount,
      note: d.note,
    })),
    {
      code: LINE_CODES.NSSF_EMPLOYER,
      kind: 'EMPLOYER',
      quantity: null,
      rate: employee.nssfApplicable ? rules.nssf.employerRateBp : null,
      amount: contributions.employer,
      note: nssfNote,
    },
    ...employerLines,
  ];

  return {
    lines,
    gross,
    taxable,
    nssfBase: contributions.base,
    paye,
    nssfEmployee: contributions.employee,
    nssfEmployer: contributions.employer,
    lst,
    otherDeductions: deductions.total,
    net,
    employerCost,
    carryForward: deductions.carryForward,
    warnings,
  };
}
