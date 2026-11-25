import { EmployeeStatus, type Prisma, WorkerType } from '@prisma/client';
import { z } from 'zod';

export const PAGE_SIZE = 25;

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

export const employeeFilterSchema = z.object({
  q: optional.transform((v) => v?.trim().slice(0, 80) || undefined),
  status: z.nativeEnum(EmployeeStatus).optional().catch(undefined),
  payGroup: optional,
  department: optional,
  workerType: z.nativeEnum(WorkerType).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type EmployeeFilters = z.infer<typeof employeeFilterSchema>;

export function parseFilters(raw: Record<string, string | string[] | undefined>): EmployeeFilters {
  return employeeFilterSchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
    ),
  );
}

export function employeeWhere(f: EmployeeFilters): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (f.q) {
    const words = f.q.split(/\s+/).filter(Boolean).slice(0, 4);
    where.AND = words.map((w) => ({
      OR: [
        { staffNo: { contains: w } },
        { firstName: { contains: w } },
        { lastName: { contains: w } },
        { otherNames: { contains: w } },
        { jobTitle: { contains: w } },
      ],
    }));
  }
  if (f.status) where.status = f.status;
  if (f.payGroup) where.payGroupId = f.payGroup;
  if (f.department) where.departmentId = f.department === 'none' ? null : f.department;
  if (f.workerType) where.workerType = f.workerType;
  return where;
}

export function pageHref(f: EmployeeFilters, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (k !== 'page' && v !== undefined && v !== '') p.set(k, String(v));
  }
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `/employees?${s}` : '/employees';
}
