import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requiredOnboardingStep } from '@/auth.config';
import { ipFromHeaders } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { ExportError, renderRecordedExport } from '@/lib/exports/service';
import { can } from '@/lib/rbac/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Download a recorded bank file. The file is rebuilt and must match its stored SHA-256. */
export async function GET(req: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser?.id || requiredOnboardingStep(sessionUser)) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, isActive: true, roles: { select: { role: { select: { code: true } } } } },
  });
  if (!user?.isActive || !can(user.roles.map((r) => r.role.code), 'payroll.export')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { exportId } = await params;
  try {
    const file = await renderRecordedExport(db, exportId, {
      actorId: user.id,
      ip: ipFromHeaders(req.headers),
    });
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-File-SHA256': file.sha256,
      },
    });
  } catch (e) {
    if (e instanceof ExportError) {
      const status = e.code === 'EXPORT_NOT_FOUND' ? 404 : 409;
      return new NextResponse(e.message, { status, headers: { 'Content-Type': 'text/plain' } });
    }
    throw e;
  }
}
