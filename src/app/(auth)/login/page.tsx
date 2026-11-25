import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Payroll' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  let target = '/dashboard';
  if (callbackUrl) {
    try {
      // Auth.js passes an absolute URL; keep only the same-origin path.
      const u = new URL(callbackUrl, 'http://local');
      target = u.pathname + u.search;
    } catch {
      /* keep default */
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll</CardTitle>
        <CardDescription>Sign in with your work email.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm callbackUrl={target} />
      </CardContent>
    </Card>
  );
}
