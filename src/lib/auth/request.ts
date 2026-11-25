import 'server-only';
import { headers } from 'next/headers';

/** Best-effort client IP for audit entries. */
export function ipFromHeaders(h: Headers): string | null {
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return h.get('x-real-ip');
}

export async function currentIp(): Promise<string | null> {
  return ipFromHeaders(await headers());
}
