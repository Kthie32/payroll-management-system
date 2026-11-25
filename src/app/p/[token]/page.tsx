import { cookies } from 'next/headers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accessCookieName, verifyAccessCookie } from '@/lib/payroll/payslip-links';
import { findDeliveryByToken, isLinkLocked } from '@/lib/payroll/server/delivery';
import { loadPayslips } from '@/lib/payroll/server/payslips';
import { getSettings } from '@/lib/settings/general';
import { db } from '@/lib/db';
import { PayslipCard } from '../../(app)/payroll/_components/payslip-card';
import { VerifyForm } from './verify-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your payslip',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-3xl space-y-4 px-4 py-8">{children}</main>;
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{text}</CardDescription>
        </CardHeader>
      </Card>
    </Shell>
  );
}

/**
 * Public payslip link (sent by email or SMS). Outside the login gate. Shows nothing about the
 * employee until they confirm the last 4 digits of their phone or their staff number.
 */
export default async function PublicPayslipPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const delivery = await findDeliveryByToken(token);
  if (!delivery) {
    return (
      <Message
        title="Link not available"
        text="This link is invalid or has expired. Ask the payroll office to send your payslip again."
      />
    );
  }
  const secret = process.env.AUTH_SECRET ?? '';
  const cookie = (await cookies()).get(accessCookieName(delivery.id))?.value;
  const granted = secret !== '' && verifyAccessCookie(secret, delivery.id, cookie, Date.now());

  if (!granted) {
    if (await isLinkLocked(delivery.id)) {
      return (
        <Message
          title="Link locked"
          text="Too many wrong attempts were made with this link. Ask the payroll office to send a new one."
        />
      );
    }
    const { company } = await getSettings(db);
    return (
      <Shell>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>{company.name || 'Payslip'}</CardTitle>
            <CardDescription>
              Hello {delivery.runEmployee.employee.firstName}. To protect your pay details, confirm
              who you are.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VerifyForm token={token} />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const [p] = await loadPayslips(delivery.runEmployee.runId, delivery.runEmployee.employeeId);
  if (!p) return <Message title="Payslip not found" text="Contact the payroll office." />;
  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted-foreground">
          Link valid until{' '}
          {new Intl.DateTimeFormat('en-GB', {
            dateStyle: 'medium',
            timeZone: 'Africa/Kampala',
          }).format(delivery.expiresAt)}
          . Do not share it.
        </p>
        <Button asChild>
          <a href={`/api/p/${token}`}>Download PDF</a>
        </Button>
      </div>
      <PayslipCard p={p} />
    </Shell>
  );
}
