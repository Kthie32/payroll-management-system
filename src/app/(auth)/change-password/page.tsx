import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from './change-password-form';

export const metadata = { title: 'Change password · Payroll' };

export default function ChangePasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
        <CardDescription>
          You signed in with a temporary password. Choose a new one to continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePasswordForm />
        <p className="mt-4 text-center text-sm">
          <a href="/logout" className="text-muted-foreground hover:underline">
            Sign out
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
