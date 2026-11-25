import { StatutoryRule } from '@prisma/client';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { toIsoDate } from '@/lib/settings/input';
import { paramsToRuleForm } from '@/lib/settings/rule-form';
import { latestVersion, RULE_LABELS } from '@/lib/settings/rules';
import { PageHeader } from '../../_components/page-header';
import { RuleEditor } from '../rule-editor';

export const metadata = { title: 'New statutory rule version · Payroll' };
export const dynamic = 'force-dynamic';

export default async function NewRuleVersionPage({
  searchParams,
}: {
  searchParams: Promise<{ rule?: string }>;
}) {
  await requirePermission('rules.edit');
  const { rule: raw } = await searchParams;
  const rule = Object.values(StatutoryRule).find((r) => r === raw);
  if (!rule) notFound();

  // Pre-fill from the latest version of this rule (or PAYE residents for a first non-resident
  // version) so the user edits what changed rather than re-typing everything.
  const versions = await db.statutoryRuleVersion.findMany({
    where: { rule: { in: rule === 'PAYE_NONRES' ? ['PAYE_NONRES', 'PAYE_RES'] : [rule] } },
  });
  const base = latestVersion(versions, rule) ?? (rule === 'PAYE_NONRES' ? latestVersion(versions, 'PAYE_RES') : null);
  const initial = paramsToRuleForm(rule, base?.params);
  const nextYear = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 6, 1));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`New version: ${RULE_LABELS[rule]}`}
        description={
          base
            ? `Pre-filled from the version starting ${toIsoDate(base.effectiveFrom)}. Change what is different.`
            : 'Enter the rule as published.'
        }
        back={{ href: '/settings/statutory', label: 'Statutory rules' }}
      />
      <Card>
        <CardContent className="pt-6">
          <RuleEditor initial={initial} defaultEffectiveFrom={toIsoDate(nextYear)} />
        </CardContent>
      </Card>
    </div>
  );
}
