import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  applyTokens,
  batchRef,
  buildBankFile,
  buildBankGrid,
  ExportTotalsError,
  formatAmount,
  formatDate,
  periodLabel,
  type BankFileContext,
  type PaymentRow,
} from '../build';
import { planPayments, readyToMarkExported, type PayeeInput } from '../group';
import {
  DEFAULT_TEMPLATE,
  parseRowsText,
  parseTemplate,
  rowsToText,
  type ExportTemplateSpec,
} from '../template';
import { csvCell, safeFileName, sha256Hex, toCsv, toXlsx } from '../writers';
import { normalizeZipTimestamps } from '../zip-normalize';

const ctx: BankFileContext = {
  companyName: 'Acme Ltd',
  bankName: 'Stanbic Bank',
  bankCode: 'SBIC',
  batchRef: '202611-SBIC-V1',
  payDate: '2026-11-28',
  period: 'NOV 2026',
};

const rows: PaymentRow[] = [
  {
    staffNo: 'E001',
    employeeName: 'Jane Doe',
    accountName: 'Jane Doe',
    accountNo: '9030001234567',
    branchCode: '001',
    amount: 761_750,
  },
  {
    staffNo: 'E002',
    employeeName: 'Okello, Peter "PJ"',
    accountName: 'Peter Okello',
    accountNo: '9030007654321',
    branchCode: null,
    amount: 500_000,
  },
];

describe('csv writer', () => {
  it('quotes commas, quotes, newlines and edge spaces', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(' lead')).toBe('" lead"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('guards spreadsheet formulas only when asked', () => {
    expect(csvCell('=SUM(A1)')).toBe('=SUM(A1)');
    expect(csvCell('=SUM(A1)', { guardFormulas: true })).toBe("'=SUM(A1)");
    expect(csvCell('-5', { guardFormulas: true })).toBe("'-5");
    expect(csvCell(-5, { guardFormulas: true })).toBe('-5');
  });

  it('uses CRLF line endings with a trailing CRLF', () => {
    expect(
      toCsv([
        ['a', 1],
        ['b', 2],
      ]).toString(),
    ).toBe('a,1\r\nb,2\r\n');
    expect(toCsv([]).length).toBe(0);
  });
});

describe('formatting', () => {
  it('formats amounts without separators', () => {
    expect(formatAmount(761_750, 'INTEGER')).toBe('761750');
    expect(formatAmount(761_750, 'DECIMAL_2')).toBe('761750.00');
    expect(() => formatAmount(1.5, 'INTEGER')).toThrow();
  });

  it('formats dates', () => {
    expect(formatDate('2026-11-28', 'DATE_ISO')).toBe('2026-11-28');
    expect(formatDate('2026-11-28', 'DATE_DMY')).toBe('28/11/2026');
    expect(formatDate('2026-11-28', 'DATE_YMD')).toBe('20261128');
    expect(() => formatDate('28/11/2026', 'DATE_ISO')).toThrow();
  });

  it('replaces known tokens and leaves unknown ones', () => {
    expect(applyTokens('{count} rows, {total} UGX {nope}', { count: 2, total: 10 })).toBe(
      '2 rows, 10 UGX {nope}',
    );
  });

  it('builds batch references and period labels', () => {
    expect(batchRef('2026-11-28', 'sbic-01', 3)).toBe('202611-SBIC01-V3');
    expect(periodLabel('2026-11-28')).toBe('NOV 2026');
    expect(periodLabel('2026-01-05')).toBe('JAN 2026');
  });

  it('makes safe file names', () => {
    expect(safeFileName('Payroll register: Nov/2026.xlsx')).toBe('Payroll_register_Nov_2026.xlsx');
  });
});

describe('bank grid', () => {
  it('uses the default template: column headers, data rows, total footer', () => {
    const { grid, dataRowCount, totalAmount, headerRowIndexes } = buildBankGrid(
      DEFAULT_TEMPLATE,
      rows,
      ctx,
    );
    expect(dataRowCount).toBe(2);
    expect(totalAmount).toBe(1_261_750);
    expect(headerRowIndexes).toEqual([0]);
    expect(grid[0]).toEqual([
      'Staff No',
      'Employee Name',
      'Account Name',
      'Account Number',
      'Branch Code',
      'Bank Code',
      'Amount',
      'Narrative',
      'Pay Date',
    ]);
    expect(grid[1]).toEqual([
      'E001',
      'Jane Doe',
      'Jane Doe',
      '9030001234567',
      '001',
      'SBIC',
      '761750',
      'SALARY NOV 2026',
      '2026-11-28',
    ]);
    expect(grid[2]?.[4]).toBe('');
    expect(grid[3]).toEqual(['TOTAL', '2', '1261750']);
  });

  it('applies header rows, formats and custom narrative', () => {
    const t: ExportTemplateSpec = {
      format: 'CSV',
      mapping: {
        columns: [
          { header: 'ACC', field: 'accountNo', format: 'AS_IS' },
          { header: 'NAME', field: 'accountName', format: 'UPPER' },
          { header: 'AMT', field: 'amount', format: 'DECIMAL_2' },
          { header: 'DATE', field: 'payDate', format: 'DATE_DMY' },
          { header: 'REF', field: 'narrative', format: 'AS_IS' },
          { header: 'STAFF', field: 'staffNo', format: 'AS_IS' },
          { header: 'EMP', field: 'employeeName', format: 'UPPER' },
          { header: 'BR', field: 'branchCode', format: 'AS_IS' },
          { header: 'BANK', field: 'bankCode', format: 'AS_IS' },
          { header: 'D2', field: 'payDate', format: 'AS_IS' },
        ],
        narrative: '{companyName} {batchRef}',
      },
      headerRules: { includeColumnHeaders: false, rows: [['H', '{bankName}', '{total}']] },
      footerRules: { rows: [] },
    };
    const { grid, headerRowIndexes } = buildBankGrid(t, rows.slice(0, 1), ctx);
    expect(headerRowIndexes).toEqual([]);
    expect(grid[0]).toEqual(['H', 'Stanbic Bank', '761750']);
    expect(grid[1]).toEqual([
      '9030001234567',
      'JANE DOE',
      '761750.00',
      '28/11/2026',
      'Acme Ltd 202611-SBIC-V1',
      'E001',
      'JANE DOE',
      '001',
      'SBIC',
      '2026-11-28',
    ]);
    expect(grid).toHaveLength(2);
  });

  it('rejects non-integer amounts', () => {
    const bad = [{ ...rows[0]!, amount: 10.5 }];
    expect(() => buildBankGrid(DEFAULT_TEMPLATE, bad, ctx)).toThrow();
  });
});

describe('bank file', () => {
  it('produces a deterministic CSV with matching checksum', async () => {
    const a = await buildBankFile(DEFAULT_TEMPLATE, rows, ctx, 1_261_750);
    const b = await buildBankFile(DEFAULT_TEMPLATE, rows, ctx, 1_261_750);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toBe(sha256Hex(a.bytes));
    expect(a.rowCount).toBe(2);
    expect(a.totalAmount).toBe(1_261_750);
    expect(a.bytes.toString()).toContain('"Okello, Peter ""PJ"""');
  });

  it('refuses to build a file whose total does not reconcile', async () => {
    await expect(buildBankFile(DEFAULT_TEMPLATE, rows, ctx, 1)).rejects.toBeInstanceOf(
      ExportTotalsError,
    );
  });

  it('produces a deterministic, readable XLSX', async () => {
    const t = { ...DEFAULT_TEMPLATE, format: 'XLSX' as const };
    const a = await buildBankFile(t, rows, ctx, 1_261_750);
    await new Promise((r) => setTimeout(r, 2100)); // cross a DOS 2-second timestamp boundary
    const b = await buildBankFile(t, rows, ctx, 1_261_750);
    expect(a.sha256).toBe(b.sha256);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(a.bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(2).getCell(4).value).toBe('9030001234567');
    expect(ws.getRow(2).getCell(7).value).toBe('761750');
    expect(ws.getRow(1).font?.bold).toBe(true);
  }, 15_000);

  it('a different batch reference changes the checksum', async () => {
    const t = {
      ...DEFAULT_TEMPLATE,
      headerRules: { includeColumnHeaders: true, rows: [['{batchRef}']] },
    };
    const a = await buildBankFile(t, rows, ctx, 1_261_750);
    const b = await buildBankFile(t, rows, { ...ctx, batchRef: '202611-SBIC-V2' }, 1_261_750);
    expect(a.sha256).not.toBe(b.sha256);
  });
});

describe('xlsx writer', () => {
  it('writes money columns, bold rows and sanitises sheet names', async () => {
    const buf = await toXlsx(
      [
        ['Name', 'Net'],
        ['A', 1000],
        ['Total', 1000],
      ],
      {
        sheetName: 'Bad/Name:*?',
        timestamp: new Date('2026-11-28'),
        boldRows: [0, 2],
        moneyColumns: [1],
      },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Bad Name');
    expect(ws.getRow(2).getCell(2).value).toBe(1000);
    expect(ws.getColumn(2).numFmt).toBe('#,##0');
  });

  it('falls back to a default sheet name', async () => {
    const buf = await toXlsx([[null]], { sheetName: '///', timestamp: new Date('2026-01-01') });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.name).toBe('Sheet1');
  });
});

describe('zip normaliser', () => {
  it('rejects non-zip input', () => {
    expect(() => normalizeZipTimestamps(new Uint8Array(40))).toThrow(/Not a ZIP/);
  });
});

describe('payment plan', () => {
  const account = (bankId: string, bankName: string) => ({
    bankId,
    bankName,
    bankCode: bankId.toUpperCase(),
    bankKind: 'BANK' as const,
    branchCode: null,
    accountName: 'x',
    accountNoEnc: 'enc',
    accountNoLast4: '1234',
  });
  const payees: PayeeInput[] = [
    {
      employeeId: '1',
      staffNo: 'E3',
      employeeName: 'C',
      net: 300,
      account: account('b', 'Bank B'),
    },
    {
      employeeId: '2',
      staffNo: 'E1',
      employeeName: 'A',
      net: 100,
      account: account('a', 'Bank A'),
    },
    {
      employeeId: '3',
      staffNo: 'E2',
      employeeName: 'B',
      net: 200,
      account: account('b', 'Bank B'),
    },
    { employeeId: '4', staffNo: 'E4', employeeName: 'D', net: 400, account: null },
    { employeeId: '5', staffNo: 'E5', employeeName: 'E', net: 0, account: null },
  ];

  it('groups by bank, sorts, and separates missing accounts and zero net', () => {
    const plan = planPayments(payees);
    expect(plan.groups.map((g) => [g.bankName, g.total, g.payees.map((p) => p.staffNo)])).toEqual([
      ['Bank A', 100, ['E1']],
      ['Bank B', 500, ['E2', 'E3']],
    ]);
    expect(plan.missingAccounts.map((p) => p.staffNo)).toEqual(['E4']);
    expect(plan.zeroNet.map((p) => p.staffNo)).toEqual(['E5']);
    expect(plan.runNetTotal).toBe(1000);
  });

  it('is ready to mark exported only when every bank has a file and no account is missing', () => {
    const blocked = planPayments(payees);
    expect(readyToMarkExported(blocked, new Set(['a', 'b']))).toBe(false);
    const ok = planPayments(payees.filter((p) => p.employeeId !== '4'));
    expect(readyToMarkExported(ok, new Set(['a']))).toBe(false);
    expect(readyToMarkExported(ok, new Set(['a', 'b']))).toBe(true);
    expect(readyToMarkExported(planPayments([]), new Set())).toBe(true);
  });
});

describe('template parsing', () => {
  it('parses stored JSON and falls back to defaults for invalid parts', () => {
    const t = parseTemplate({
      format: 'XLSX',
      mapping: { columns: [{ header: 'A', field: 'amount' }] },
      headerRules: 'garbage',
      footerRules: null,
    });
    expect(t.format).toBe('XLSX');
    expect(t.mapping.columns).toEqual([{ header: 'A', field: 'amount', format: 'AS_IS' }]);
    expect(t.mapping.narrative).toBe('SALARY {period}');
    expect(t.headerRules).toEqual(DEFAULT_TEMPLATE.headerRules);
    expect(t.footerRules).toEqual({ rows: [] });
    const bad = parseTemplate({
      format: 'CSV',
      mapping: { columns: [] },
      headerRules: {},
      footerRules: {},
    });
    expect(bad.mapping).toEqual(DEFAULT_TEMPLATE.mapping);
  });

  it('converts header/footer text to rows and back', () => {
    const rowsIn = parseRowsText('H | {bankName}\n\n  F|{total} \r\n');
    expect(rowsIn).toEqual([
      ['H', '{bankName}'],
      ['F', '{total}'],
    ]);
    expect(rowsToText(rowsIn)).toBe('H | {bankName}\nF | {total}');
  });
});
