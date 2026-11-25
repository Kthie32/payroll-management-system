import 'server-only';
import { db } from '@/lib/db';

/** True if a pay component has been assigned, input or paid; such components can only be deactivated. */
export async function componentInUse(id: string, code: string): Promise<boolean> {
  const [assigned, inputs, lines] = await Promise.all([
    db.employeeComponent.count({ where: { componentId: id } }),
    db.payrollInput.count({ where: { componentId: id } }),
    db.payrollLine.count({ where: { code } }),
  ]);
  return assigned + inputs + lines > 0;
}

/** True if a pay group has employees, periods or runs; such groups cannot be deleted. */
export async function payGroupUsage(id: string) {
  const [employees, periods, runs] = await Promise.all([
    db.employee.count({ where: { payGroupId: id } }),
    db.payPeriod.count({ where: { payGroupId: id } }),
    db.payrollRun.count({ where: { payGroupId: id } }),
  ]);
  return { employees, periods, runs, inUse: employees + periods + runs > 0 };
}
