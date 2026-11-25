import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TotpForm } from '../totp-form';

export const metadata = { title: 'Two-factor check · Payroll' };

export default function VerifyPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor check</CardTitle>
        <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        <TotpForm mode="verify" />
        <p className="mt-4 text-center text-sm">
          <a href="/logout" className="text-muted-foreground hover:underline">
            Sign out
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
