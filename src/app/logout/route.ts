import { signOut } from '@/auth';

// Route handler so it can clear the session cookie (server components cannot).
export async function GET() {
  await signOut({ redirectTo: '/login' });
}

export const POST = GET;
