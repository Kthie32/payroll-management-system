import { Fragment } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtMoney } from '@/lib/reports/format';
import type { ReportColumn, ReportTable, ReportValue } from '@/lib/reports/types';
import { cn } from '@/lib/utils';

function cell(c: ReportColumn, v: ReportValue) {
  if (v === null || v === undefined) return '';
  if (c.type === 'money' && typeof v === 'number') return fmtMoney(v);
  return String(v);
}

/** Renders any ReportTable; numbers right-aligned, optional group headings, totals row. */
export function ReportTableView({ table }: { table: ReportTable }) {
  const { columns, rows, totals, groupBy } = table;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data for this selection.</p>;
  }
  let lastGroup: ReportValue | undefined;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={cn('whitespace-nowrap', c.type !== 'text' && 'text-right')}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const group = groupBy ? r[groupBy] : undefined;
          const heading = groupBy && group !== lastGroup;
          lastGroup = group;
          return (
            <Fragment key={i}>
              {heading ? (
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={columns.length} className="font-semibold">
                    {String(group ?? '')}
                  </TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn('whitespace-nowrap', c.type !== 'text' && 'text-right tabular-nums')}
                  >
                    {cell(c, r[c.key] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            </Fragment>
          );
        })}
        {totals ? (
          <TableRow className="border-t-2 font-semibold">
            {columns.map((c) => (
              <TableCell
                key={c.key}
                className={cn('whitespace-nowrap', c.type !== 'text' && 'text-right tabular-nums')}
              >
                {cell(c, totals[c.key] ?? null)}
              </TableCell>
            ))}
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
