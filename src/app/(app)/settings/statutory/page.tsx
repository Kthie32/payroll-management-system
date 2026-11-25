import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { toIsoDate } from '@/lib/settings/input';
import { resolveRuleVersion, RULE_LABELS, STATUTORY_RULES } from '@/lib/settings/rules';
import { PageHeader } from '../_components/page-header';
import { kampalaToday, versionStatus } from './status';

export const metadata = { title: 'Statutory rules · Payroll' };
export const dynamic = 'force-dynamic';

export default async function StatutoryPage() {
  const user = await requirePermission('settings.view');
  const canEdit = can(user.roles, 'rules.edit');
  const versions = await db.statutoryRuleVersion.findMany({
    orderBy: [{ effectiveFrom: 'desc' }],
    include: { approvedBy: { select: { name: true } } },
  });
  const today = kampalaToday();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory rules"
        description="Payroll uses the approved version in effect on each pay date. New versions start as drafts."
        back={{ href: '/settings', label: 'Settings' }}
      />
      {STATUTORY_RULES.map((rule) => {
        const list = versions.filter((v) => v.rule === rule);
        const current = resolveRuleVersion(list, rule, today);
        return (
          <Card key={rule}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>{RULE_LABELS[rule]}</CardTitle>
              {canEdit ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/settings/statutory/new?rule=${rule}`}>
                    <Plus aria-hidden /> New version
                  </Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No versions.{' '}
                  {rule === 'PAYE_NONRES'
                    ? 'Payroll for non-resident employees will stop with an error until one is approved.'
                    : null}
                </p>
              ) : (
                <ul className="divide-y">
                  {list.map((v) => {
                    const s = versionStatus(v, current, today);
                    return (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                        <Link href={`/settings/statutory/${v.id}`} className="space-y-0.5 hover:underline">
                          <span className="font-medium tabular-nums">
                            {toIsoDate(v.effectiveFrom)} → {v.effectiveTo ? toIsoDate(v.effectiveTo) : 'open'}
                          </span>
                          {v.approvedBy ? (
                            <span className="block text-xs text-muted-foreground">
                              Approved by {v.approvedBy.name}
                            </span>
                          ) : null}
                        </Link>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
