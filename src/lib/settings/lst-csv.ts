import Papa from 'papaparse';
import { parseUgxInput } from './input';

export interface LstBandRow {
  from: number;
  to: number | null;
  annual: number;
}

export type LstCsvResult = { ok: true; bands: LstBandRow[] } | { ok: false; errors: string[] };

/**
 * Parse LST bands from CSV with a header row: `from,to,annual` (amounts in UGX, `to` empty for
 * the open-ended top band). Client-safe. Contiguity is checked later by the engine schema.
 */
export function parseLstBandsCsv(text: string): LstCsvResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const errors: string[] = parsed.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  const fields = parsed.meta.fields ?? [];
  for (const col of ['from', 'to', 'annual']) {
    if (!fields.includes(col)) errors.push(`Missing column "${col}"`);
  }
  if (errors.length) return { ok: false, errors };

  const bands: LstBandRow[] = [];
  parsed.data.forEach((row, i) => {
    const line = i + 2;
    const from = parseUgxInput(row.from ?? '');
    const toRaw = (row.to ?? '').trim();
    const to = toRaw === '' ? null : parseUgxInput(toRaw);
    const annual = parseUgxInput(row.annual ?? '');
    if (from === null) errors.push(`Row ${line}: "from" must be a whole UGX amount`);
    if (toRaw !== '' && to === null) errors.push(`Row ${line}: "to" must be a whole UGX amount`);
    if (annual === null) errors.push(`Row ${line}: "annual" must be a whole UGX amount`);
    if (from !== null && annual !== null && (toRaw === '' || to !== null)) {
      bands.push({ from, to, annual });
    }
  });
  if (bands.length === 0 && errors.length === 0) errors.push('No bands found');
  return errors.length ? { ok: false, errors } : { ok: true, bands };
}
