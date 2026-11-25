import { z } from 'zod';

/** Fields a bank file column can draw from. */
export const EXPORT_FIELDS = [
  'staffNo',
  'employeeName',
  'accountName',
  'accountNo',
  'branchCode',
  'bankCode',
  'amount',
  'narrative',
  'payDate',
] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ExportField, string> = {
  staffNo: 'Staff number',
  employeeName: 'Employee name',
  accountName: 'Account name',
  accountNo: 'Account number',
  branchCode: 'Branch code',
  bankCode: 'Bank code',
  amount: 'Amount (net pay)',
  narrative: 'Narrative',
  payDate: 'Pay date',
};

/** Column formats. Amount: whole shillings or with ".00". Dates: three layouts. Text: as-is or upper. */
export const COLUMN_FORMATS = [
  'AS_IS',
  'UPPER',
  'INTEGER',
  'DECIMAL_2',
  'DATE_ISO',
  'DATE_DMY',
  'DATE_YMD',
] as const;
export type ColumnFormat = (typeof COLUMN_FORMATS)[number];

export const FORMAT_LABELS: Record<ColumnFormat, string> = {
  AS_IS: 'As is',
  UPPER: 'UPPER CASE',
  INTEGER: 'Whole number (761750)',
  DECIMAL_2: 'Two decimals (761750.00)',
  DATE_ISO: 'Date 2026-11-28',
  DATE_DMY: 'Date 28/11/2026',
  DATE_YMD: 'Date 20261128',
};

export const columnSchema = z.object({
  header: z.string().trim().min(1, 'Every column needs a header').max(60),
  field: z.enum(EXPORT_FIELDS),
  format: z.enum(COLUMN_FORMATS).default('AS_IS'),
});
export type ExportColumn = z.infer<typeof columnSchema>;

export const mappingSchema = z.object({
  columns: z.array(columnSchema).min(1, 'Add at least one column').max(30),
  /** Narrative text; tokens allowed (see TOKENS). */
  narrative: z.string().trim().max(60).default('SALARY {period}'),
});
export type ExportMapping = z.infer<typeof mappingSchema>;

/**
 * Header/footer rows. Each row is a list of cells; cells may contain tokens such as {total}.
 * `includeColumnHeaders` controls the row of column titles between header rows and data.
 */
export const headerRulesSchema = z.object({
  includeColumnHeaders: z.boolean().default(true),
  rows: z.array(z.array(z.string().max(120)).max(30)).max(10).default([]),
});
export const footerRulesSchema = z.object({
  rows: z.array(z.array(z.string().max(120)).max(30)).max(10).default([]),
});
export type HeaderRules = z.infer<typeof headerRulesSchema>;
export type FooterRules = z.infer<typeof footerRulesSchema>;

export interface ExportTemplateSpec {
  format: 'CSV' | 'XLSX';
  mapping: ExportMapping;
  headerRules: HeaderRules;
  footerRules: FooterRules;
}

/** Tokens usable in narrative, header and footer cells. */
export const TOKENS = [
  '{companyName}',
  '{bankName}',
  '{bankCode}',
  '{batchRef}',
  '{payDate}',
  '{period}',
  '{count}',
  '{total}',
] as const;

/** Generic template used for any bank without its own. */
export const DEFAULT_TEMPLATE: ExportTemplateSpec = {
  format: 'CSV',
  mapping: {
    columns: [
      { header: 'Staff No', field: 'staffNo', format: 'AS_IS' },
      { header: 'Employee Name', field: 'employeeName', format: 'AS_IS' },
      { header: 'Account Name', field: 'accountName', format: 'AS_IS' },
      { header: 'Account Number', field: 'accountNo', format: 'AS_IS' },
      { header: 'Branch Code', field: 'branchCode', format: 'AS_IS' },
      { header: 'Bank Code', field: 'bankCode', format: 'AS_IS' },
      { header: 'Amount', field: 'amount', format: 'INTEGER' },
      { header: 'Narrative', field: 'narrative', format: 'UPPER' },
      { header: 'Pay Date', field: 'payDate', format: 'DATE_ISO' },
    ],
    narrative: 'SALARY {period}',
  },
  headerRules: { includeColumnHeaders: true, rows: [] },
  footerRules: { rows: [['TOTAL', '{count}', '{total}']] },
};

/** Parse stored JSON into a template spec, falling back to defaults for any invalid part. */
export function parseTemplate(row: {
  format: 'CSV' | 'XLSX';
  mapping: unknown;
  headerRules: unknown;
  footerRules: unknown;
}): ExportTemplateSpec {
  const mapping = mappingSchema.safeParse(row.mapping);
  const header = headerRulesSchema.safeParse(row.headerRules ?? {});
  const footer = footerRulesSchema.safeParse(row.footerRules ?? {});
  return {
    format: row.format,
    mapping: mapping.success ? mapping.data : DEFAULT_TEMPLATE.mapping,
    headerRules: header.success ? header.data : DEFAULT_TEMPLATE.headerRules,
    footerRules: footer.success ? footer.data : DEFAULT_TEMPLATE.footerRules,
  };
}

/** "A | B | C" lines → rows of cells (used by the template editor's text areas). */
export function parseRowsText(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split('|').map((c) => c.trim()));
}

export function rowsToText(rows: string[][]): string {
  return rows.map((r) => r.join(' | ')).join('\n');
}
