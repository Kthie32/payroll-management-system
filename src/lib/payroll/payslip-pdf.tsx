import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatUgx } from '@/lib/money';
import { formatIsoDate } from './dates';
import type { PayslipLine, PayslipView } from './server/payslips';

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#1f2937' },
  watermark: {
    position: 'absolute',
    top: 330,
    left: 90,
    fontSize: 64,
    color: '#ef4444',
    opacity: 0.15,
    transform: 'rotate(-30deg)',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  company: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6b7280' },
  title: { fontSize: 12, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  box: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 4, padding: 8, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', marginBottom: 3 },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 4 },
  row: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
  label: { flex: 1 },
  qty: { width: 70, textAlign: 'right' },
  amount: { width: 90, textAlign: 'right' },
  totalRow: { flexDirection: 'row', paddingTop: 4, fontFamily: 'Helvetica-Bold' },
  netBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f3f4f6',
    padding: 10,
    borderRadius: 4,
    marginBottom: 10,
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  footer: { position: 'absolute', bottom: 24, left: 32, right: 32, fontSize: 8, color: '#6b7280', textAlign: 'center' },
});

function Lines({ title, lines, total, totalLabel }: { title: string; lines: PayslipLine[]; total?: number; totalLabel?: string }) {
  if (lines.length === 0 && total === undefined) return null;
  return (
    <View style={s.box} wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      {lines.map((l, i) => (
        <View style={s.row} key={`${l.code}-${i}`}>
          <Text style={s.label}>{l.label}</Text>
          <Text style={s.qty}>{l.quantity !== null ? String(l.quantity) : ''}</Text>
          <Text style={s.amount}>{formatUgx(l.amount)}</Text>
        </View>
      ))}
      {total !== undefined ? (
        <View style={s.totalRow}>
          <Text style={s.label}>{totalLabel}</Text>
          <Text style={s.amount}>{formatUgx(total)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PayslipPage({ p }: { p: PayslipView }) {
  const e = p.employee;
  return (
    <Page size="A4" style={s.page}>
      {p.isDraft ? <Text style={s.watermark}>DRAFT</Text> : null}
      <View style={s.header}>
        <View>
          <Text style={s.company}>{p.company.name || 'Company name not set'}</Text>
          {p.company.address ? <Text style={s.muted}>{p.company.address}</Text> : null}
          {p.company.tin ? <Text style={s.muted}>TIN {p.company.tin}</Text> : null}
          {p.company.nssfEmployerNo ? <Text style={s.muted}>NSSF employer no. {p.company.nssfEmployerNo}</Text> : null}
        </View>
        <View>
          <Text style={s.title}>PAYSLIP{p.isDraft ? ' (DRAFT)' : ''}</Text>
          <Text style={[s.muted, { textAlign: 'right' }]}>
            {formatIsoDate(p.period.start)} – {formatIsoDate(p.period.end)}
          </Text>
          <Text style={[s.muted, { textAlign: 'right' }]}>Pay date {formatIsoDate(p.period.payDate)}</Text>
        </View>
      </View>

      <View style={[s.box, s.grid]}>
        <Text style={s.cell}>Name: {e.name}</Text>
        <Text style={s.cell}>Staff no.: {e.staffNo}</Text>
        <Text style={s.cell}>Job title: {e.jobTitle ?? '—'}</Text>
        <Text style={s.cell}>Department: {e.department ?? '—'}</Text>
        <Text style={s.cell}>TIN: {e.tin ?? '—'}</Text>
        <Text style={s.cell}>NSSF no.: {e.nssfNo ?? '—'}</Text>
        <Text style={s.cell}>Pay group: {p.payGroup}</Text>
        <Text style={s.cell}>
          Bank: {e.bank ? `${e.bank.bankName} ••••${e.bank.last4}` : 'No active account'}
        </Text>
      </View>

      <Lines title="Earnings" lines={p.earnings} total={p.gross} totalLabel="Gross pay" />
      <Lines title="Statutory deductions" lines={p.statutory} />
      <Lines title="Other deductions" lines={p.deductions} total={p.totalDeductions} totalLabel="Total deductions" />

      <View style={s.netBox}>
        <Text>NET PAY</Text>
        <Text>{formatUgx(p.net)}</Text>
      </View>

      <Lines title="Employer contributions (not deducted from pay)" lines={p.employer} />

      <View style={s.box} wrap={false}>
        <Text style={s.sectionTitle}>Year to date (financial year from 1 July)</Text>
        <View style={s.grid}>
          <Text style={s.cell}>Gross: {formatUgx(p.ytd.gross)}</Text>
          <Text style={s.cell}>PAYE: {formatUgx(p.ytd.paye)}</Text>
          <Text style={s.cell}>NSSF (employee): {formatUgx(p.ytd.nssfEmployee)}</Text>
          <Text style={s.cell}>LST: {formatUgx(p.ytd.lst)}</Text>
          <Text style={s.cell}>Net pay: {formatUgx(p.ytd.net)}</Text>
        </View>
      </View>

      <Text style={s.footer} fixed>
        {p.footer || 'This payslip is computer generated and does not require a signature.'}
      </Text>
    </Page>
  );
}

export function PayslipDocument({ payslips }: { payslips: PayslipView[] }) {
  return (
    <Document title="Payslips" author={payslips[0]?.company.name || 'Payroll'}>
      {payslips.map((p) => (
        <PayslipPage key={p.employeeId} p={p} />
      ))}
    </Document>
  );
}
