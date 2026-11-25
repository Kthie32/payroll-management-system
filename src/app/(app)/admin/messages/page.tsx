import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/lib/db';
import { messagingConfig } from '@/lib/messaging';
import { can, requireUser } from '@/lib/rbac';

export const metadata = { title: 'Message outbox · Admin' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;
const SELECT =
  'flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

/**
 * Every email and SMS the system has sent or tried to send. In outbox mode this is where messages
 * go instead of being delivered. Visible to payroll officers (who send payslips), system admins
 * and auditors.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (
    !['payslips.generate', 'users.manage', 'users.view'].some((p) => can(user.roles, p as never))
  ) {
    redirect('/dashboard?denied=1');
  }
  const sp = await searchParams;
  const channel = one(sp.channel);
  const status = one(sp.status);
  const q = one(sp.q).slice(0, 100);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const where: Prisma.OutboundMessageWhereInput = {
    ...(channel === 'EMAIL' || channel === 'SMS' ? { channel } : {}),
    ...(status === 'QUEUED' || status === 'SENT' || status === 'FAILED' ? { status } : {}),
    ...(q ? { recipient: { contains: q } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.outboundMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { createdBy: { select: { name: true } } },
    }),
    db.outboundMessage.count({ where }),
  ]);
  let mode = 'outbox';
  try {
    mode = messagingConfig().mode;
  } catch {
    mode = 'misconfigured';
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (channel) u.set('channel', channel);
    if (status) u.set('status', status);
    if (q) u.set('q', q);
    u.set('page', String(p));
    return `/admin/messages?${u}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Message outbox</h1>
        <p className="text-sm text-muted-foreground">
          Emails and SMS sent by the system (payslips). Delivery mode: <strong>{mode}</strong>
          {mode === 'outbox' ? ' — messages are stored here only, not delivered.' : '.'}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <select name="channel" defaultValue={channel} className={SELECT} aria-label="Channel">
          <option value="">All channels</option>
          <option value="EMAIL">Email</option>
          <option value="SMS">SMS</option>
        </select>
        <select name="status" defaultValue={status} className={SELECT} aria-label="Status">
          <option value="">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="QUEUED">Queued</option>
        </select>
        <Input name="q" defaultValue={q} placeholder="Recipient contains…" className="w-56" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{total} message(s)</CardTitle>
          <CardDescription>Newest first. Open a message to read it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages.</p>
          ) : (
            rows.map((m) => (
              <details key={m.id} className="rounded-md border p-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <Badge variant="outline">{m.channel === 'EMAIL' ? 'Email' : 'SMS'}</Badge>
                  <Badge
                    variant={
                      m.status === 'FAILED'
                        ? 'destructive'
                        : m.status === 'SENT'
                          ? 'success'
                          : 'secondary'
                    }
                  >
                    {m.status.toLowerCase()}
                  </Badge>
                  <span className="font-medium">{m.recipient}</span>
                  {m.subject ? <span className="text-muted-foreground">· {m.subject}</span> : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {dateTime.format(m.createdAt)} · {m.provider}
                    {m.createdBy ? ` · by ${m.createdBy.name}` : ''}
                  </span>
                </summary>
                {m.error ? <p className="mt-2 text-destructive">{m.error}</p> : null}
                <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted p-3 font-sans text-xs">
                  {m.body}
                </pre>
              </details>
            ))
          )}
        </CardContent>
      </Card>

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? <Link href={href(page - 1)}>← Newer</Link> : <span />}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href(page + 1)}>Older →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
