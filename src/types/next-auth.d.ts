import type { RoleCode } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

interface PayrollAuthFields {
  roles: RoleCode[];
  mustChangePassword: boolean;
  totpEnrolled: boolean;
  twoFactorVerified: boolean;
  requires2fa: boolean;
}

declare module 'next-auth' {
  interface User extends Partial<PayrollAuthFields> {
    id?: string;
  }
  interface Session {
    user: PayrollAuthFields & { id: string } & DefaultSession['user'];
  }
}
