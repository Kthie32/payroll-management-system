import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Edge middleware: decodes the JWT only (no DB). Every route except the matcher exclusions
// goes through `authConfig.callbacks.authorized`, which allows only /login when signed out.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
