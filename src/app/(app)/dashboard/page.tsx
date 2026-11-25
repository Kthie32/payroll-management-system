import Link from 'next/link';
import { FormMessage } from '@/components/form-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { kampalaToday, loadDashboard } from '@/lib/dashboard/load';
import type { RuleState } from '@/lib/dashboard/summary';
import { can, requirePermission, ROLE_LABELS, type Permission } from '@/lib/rbac';
import { fmtCompactUgx, fmtDate, fmtMoney, runStatusLabel } from '@/lib/reports/format';
import { TrendChart } from './trend-chart';

export const metadata = { title: 'Dashboard · Payroll' };
export const dynamic = 'force-dynamic';

const RULE_LABELS: Record<string, string> = { PAYE_RES: 'PAYE (residents)', NSSF: 'NSSF' };
const RULE_BADGE: Record<RuleState, 'success' | 'warning' | 'destructive'> = {
  ok: 'success',
  expiring: 'warning',
  unapproved: 'warning',
  inactive: 'destructive',
  missing: 'destructive',
};

const QUICK_LINKS: { href: string; label: string; permission: Permission }[] = [
  { href: '/payroll', label: 'Payroll runs', permission: 'payroll.view' },
  { href: '/employees', label: 'Employees', permission: 'employees.view' },
  { href: '/exports', label: 'Bank exports', permission: 'exports.view' },
  { href: '/reports', label: 'Reports', permission: 'reports.view' },
  { href: '/loans', label: 'Loans', permission: 'loans.view' },
  { href: '/settings', label: 'Settings', permission: 'settings.view' },
  { href: '/admin/users', label: 'Users', permission: 'users.manage' },
  { href: '/audit', label: 'Audit log', permission: 'audit.view' },
];

function Kpi({
  title,
  value,
  hint,
  href,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: 'warning' | 'danger';
}) {
  const body = (
    <Card
      className={
        tone === 'danger'
          ? 'h-full border-destructive/50'
          : tone === 'warning'
            ? 'h-full border-warning'
            : 'h-full'
      }
    >
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requirePermission('dashboard.view');
  const { denied } = await searchParams;
  const today = kampalaToday();
  const d = await loadDashboard(db, today);
  const roles = user.roles;
  const isApprover = can(roles, 'payroll.approve');
  const isPreparer = can(roles, 'payroll.prepare');
  const canExport = can(roles, 'exports.generate');
  const seesRules = can(roles, 'settings.view') || can(roles, 'rules.edit');
  const ruleProblems = d.rules.filter((r) => r.state !== 'ok');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
          <p className="text-sm text-muted-foreground">
            {fmtDate(today)} ·{' '}
            {roles.length ? roles.map((r) => ROLE_LABELS[r]).join(', ') : 'No roles assigned yet'}
          </p>
        </div>
      </div>
      {denied ? <FormMessage message="You don’t have access to that page." /> : null}

      {seesRules && ruleProblems.length > 0 ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Statutory rules need attention</p>
          <ul className="mt-1 list-disc pl-5">
            {ruleProblems.map((r) => (
              <li key={r.rule}>
                {RULE_LABELS[r.rule] ?? r.rule}: {r.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          title="Active employees"
          value={fmtMoney(d.activeEmployees)}
          href={can(roles, 'employees.view') ? '/employees' : undefined}
        />
        <Kpi
          title="Last approved payroll · net"
          value={d.lastRun ? fmtCompactUgx(d.lastRun.net) : '—'}
          hint={
            d.lastRun
              ? `${d.lastRun.payGroup}, ${fmtDate(d.lastRun.payDate)} · gross ${fmtCompactUgx(d.lastRun.gross)} · ${d.lastRun.headcount} paid · ${runStatusLabel(d.lastRun.status)}`
              : 'No approved payroll yet.'
          }
        />
        <Kpi
          title="Next pay date"
          value={d.nextPayDate ? fmtDate(d.nextPayDate.payDate) : '—'}
          hint={d.nextPayDate ? d.nextPayDate.payGroup : 'No upcoming pay period set up.'}
        />
        <Kpi
          title="Missing bank accounts"
          value={fmtMoney(d.missingBankAccounts)}
          hint="Active employees without an active bank account."
          tone={d.missingBankAccounts > 0 ? 'warning' : undefined}
          href={can(roles, 'employees.view') ? '/employees' : undefined}
        />
        {isApprover ? (
          <Kpi
            title="Runs awaiting your approval"
            value={String(d.awaitingApproval)}
            tone={d.awaitingApproval > 0 ? 'warning' : undefined}
            href="/payroll"
          />
        ) : null}
        {isPreparer ? (
          <Kpi
            title="Runs in preparation"
            value={String(d.inPreparation)}
            hint="Draft, computed or rejected runs."
            href="/payroll"
          />
        ) : null}
        {canExport ? (
          <Kpi
            title="Approved, not yet exported"
            value={String(d.awaitingExport)}
            tone={d.awaitingExport > 0 ? 'warning' : undefined}
            href="/exports"
          />
        ) : null}
        <Kpi
          title="Local Service Tax"
          value={d.lst.active ? 'Active' : 'Off'}
          hint={
            d.lst.active
              ? `${d.lst.bandCount} band(s) configured.`
              : 'No active, approved LST rule. LST is not deducted.'
          }
          tone={d.lst.active ? undefined : 'warning'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Gross and net pay, last 6 months</CardTitle>
            <CardDescription>Approved runs only, by pay month (UGX).</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart points={d.trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Statutory rules</CardTitle>
            <CardDescription>Versions in force today.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.rules.map((r) => (
              <div key={r.rule} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium">{RULE_LABELS[r.rule] ?? r.rule}</div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
                <Badge variant={RULE_BADGE[r.state]}>{r.state}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {QUICK_LINKS.filter((l) => can(roles, l.permission)).map((l) => (
            <Button key={l.href} asChild variant="outline" size="sm">
              <Link href={l.href}>{l.label}</Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
