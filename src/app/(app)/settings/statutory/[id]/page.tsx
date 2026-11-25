import { notFound } from 'next/navigation';
import { FormMessage } from '@/components/form-message';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { toIsoDate } from '@/lib/settings/input';
import {
  approvalProblem,
  parseRuleParams,
  resolveRuleVersion,
  RULE_LABELS,
} from '@/lib/settings/rules';
import { PageHeader } from '../../_components/page-header';
import { RulePreview } from '../rule-preview';
import { kampalaToday, versionStatus } from '../status';
import { ApproveVersion, DiscardVersion } from './version-actions';

export const metadata = { title: 'Statutory rule version · Payroll' };
export const dynamic = 'force-dynamic';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

const BLOCKED = {
  SAME_USER: 'You entered this version, so a different Finance Approver must approve it.',
  NOT_AFTER_CURRENT:
    'An approved version already starts on or after this date. Discard this draft and enter one with a later date.',
  LST_NO_BANDS: 'Add LST bands (as a new version) before approving.',
  INVALID_PARAMS: 'The parameters are not valid; discard this draft and enter it again.',
  ALREADY_APPROVED: null,
} as const;

export default async function RuleVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requirePermission('settings.view');
  const { id } = await params;
  const { created } = await searchParams;
  const v = await db.statutoryRuleVersion.findUnique({
    where: { id },
    include: { approvedBy: { select: { name: true } } },
  });
  if (!v) notFound();

  const [siblings, createdEntry] = await Promise.all([
    db.statutoryRuleVersion.findMany({ where: { rule: v.rule } }),
    db.auditLog.findFirst({
      where: {
        entity: 'StatutoryRuleVersion',
        entityId: v.id,
        action: { in: ['RULE_VERSION_CREATED', 'SEED_CREATE'] },
      },
      include: { actor: { select: { name: true } } },
    }),
  ]);
  const today = kampalaToday();
  const status = versionStatus(v, resolveRuleVersion(siblings, v.rule, today), today);
  const parsed = parseRuleParams(v.rule, v.params);
  const isDraft = !v.approvedById;
  const canApprove = can(user.roles, 'rules.approve');
  const canEdit = can(user.roles, 'rules.edit');
  const problem = isDraft
    ? approvalProblem(v, siblings, createdEntry?.actorId ?? null, user.id)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={RULE_LABELS[v.rule]}
        description={`Effective ${toIsoDate(v.effectiveFrom)} → ${v.effectiveTo ? toIsoDate(v.effectiveTo) : 'until replaced'}`}
        back={{ href: '/settings/statutory', label: 'Statutory rules' }}
        actions={<Badge variant={status.variant}>{status.label}</Badge>}
      />
      {created ? <FormMessage tone="success" message="Draft saved. A Finance Approver must approve it." /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Parameters</CardTitle>
          {v.sourceUrl ? (
            <CardDescription>
              Source:{' '}
              <a href={v.sourceUrl} target="_blank" rel="noreferrer" className="break-all underline">
                {v.sourceUrl}
              </a>
            </CardDescription>
          ) : (
            <CardDescription>No source link recorded.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {parsed.ok ? (
            <RulePreview rule={v.rule} params={parsed.params} />
          ) : (
            <FormMessage message={`Stored parameters are not valid: ${parsed.error}`} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approval</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Entered by</dt>
            <dd>
              {createdEntry
                ? `${createdEntry.actor?.name ?? 'System seed'} · ${dateTime.format(createdEntry.at)}`
                : 'Unknown'}
            </dd>
            <dt className="text-muted-foreground">Approved by</dt>
            <dd>
              {v.approvedBy && v.approvedAt
                ? `${v.approvedBy.name} · ${dateTime.format(v.approvedAt)}`
                : 'Not yet approved'}
            </dd>
          </dl>
          {isDraft && canApprove ? (
            <ApproveVersion id={v.id} blockedReason={problem ? BLOCKED[problem] : null} />
          ) : null}
          {isDraft && !canApprove ? (
            <p className="text-muted-foreground">A Finance Approver must approve this draft.</p>
          ) : null}
          {isDraft && canEdit ? <DiscardVersion id={v.id} /> : null}
          {!isDraft ? (
            <p className="text-muted-foreground">
              Approved versions cannot be edited. To change the rule, enter a new version with a
              later effective date; approving it closes this one the day before.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
