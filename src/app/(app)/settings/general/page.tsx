import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { getSettings } from '@/lib/settings/general';
import { bpToPercent } from '@/lib/settings/input';
import { PageHeader, ReadOnlyNote } from '../_components/page-header';
import { GeneralSettingsForm } from './general-form';

export const metadata = { title: 'General settings · Payroll' };
export const dynamic = 'force-dynamic';

export default async function GeneralSettingsPage() {
  const user = await requirePermission('settings.view');
  const canEdit = can(user.roles, 'settings.edit');
  const s = await getSettings(db);

  return (
    <div className="space-y-6">
      <PageHeader
        title="General settings"
        description="Company details appear on payslips and statutory returns."
        back={{ href: '/settings', label: 'Settings' }}
      />
      {!canEdit ? <ReadOnlyNote>You can view these settings but not change them.</ReadOnlyNote> : null}
      <Card>
        <CardContent className="pt-6">
          <GeneralSettingsForm
            canEdit={canEdit}
            initial={{
              minNetPay: bpToPercent(s.minNetPayBp),
              prorationBasis: s.prorationBasis,
              companyName: s.company.name,
              companyTin: s.company.tin,
              companyNssfEmployerNo: s.company.nssfEmployerNo,
              companyAddress: s.company.address,
              payslipFooter: s.payslipFooter,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
