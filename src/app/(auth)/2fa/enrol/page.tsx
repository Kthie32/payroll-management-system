import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { generateTotpSecret, sealPendingSecret, totpQrDataUrl } from '@/lib/auth/totp';
import { db } from '@/lib/db';
import { TotpForm } from '../totp-form';

export const metadata = { title: 'Set up two-factor · Payroll' };
export const dynamic = 'force-dynamic';

export default async function EnrolPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) redirect('/logout');
  if (user.totpEnrolledAt) redirect('/2fa/verify');

  const secret = generateTotpSecret();
  const qr = await totpQrDataUrl(user.email, secret);
  const pending = sealPendingSecret(userId, secret);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
        <CardDescription>
          Your role requires a second factor. Scan this code with an authenticator app (Google
          Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="QR code for your authenticator app"
            width={220}
            height={220}
            className="rounded-md border bg-white p-2"
          />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-xs text-muted-foreground">Can’t scan? Enter this key manually:</p>
          <code
            data-testid="totp-secret"
            className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-wider"
          >
            {secret}
          </code>
        </div>
        <TotpForm mode="enrol" pending={pending} />
        <p className="text-center text-sm">
          <a href="/logout" className="text-muted-foreground hover:underline">
            Sign out
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
