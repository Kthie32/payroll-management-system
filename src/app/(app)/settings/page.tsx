import { Building2, Layers, Scale, Users, Landmark } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from './_components/page-header';

export const metadata = { title: 'Settings · Payroll' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requirePermission('settings.view');
  const [components, groups, drafts] = await Promise.all([
    db.payComponent.count({ where: { isActive: true } }),
    db.payGroup.count(),
    db.statutoryRuleVersion.count({ where: { approvedById: null } }),
  ]);

  const sections = [
    {
      href: '/settings/statutory',
      icon: Scale,
      title: 'Statutory rules',
      description:
        'PAYE, NSSF and LST rates and bands, versioned by effective date and approved by Finance.',
      badge: drafts ? `${drafts} awaiting approval` : null,
    },
    {
      href: '/settings/components',
      icon: Layers,
      title: 'Pay components',
      description:
        'Earnings, deductions and employer costs: how each is calculated, taxed and ordered.',
      badge: `${components} active`,
    },
    {
      href: '/settings/pay-groups',
      icon: Users,
      title: 'Pay groups',
      description:
        'Groups of employees paid on the same schedule (monthly, fortnightly or weekly).',
      badge: `${groups}`,
    },
    {
      href: '/settings/general',
      icon: Building2,
      title: 'General',
      description: 'Company details, minimum net pay, proration basis and payslip footer.',
      badge: null,
    },
    {
      href: '/exports/templates',
      icon: Landmark,
      title: 'Bank file templates',
      description: 'Column layout, header and footer rows for each bank payment file.',
      badge: null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Configuration used by every payroll run." />
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <s.icon className="size-5 text-primary" aria-hidden />
                    {s.title}
                  </CardTitle>
                  {s.badge ? (
                    <Badge variant={s.badge.includes('awaiting') ? 'warning' : 'secondary'}>
                      {s.badge}
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
