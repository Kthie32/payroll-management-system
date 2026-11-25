import Link from 'next/link';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/employees', label: 'Employees' },
  { href: '/employees/departments', label: 'Departments' },
  { href: '/employees/import', label: 'Import CSV', editOnly: true },
] as const;

/** Sub-navigation shared by the employee area pages. */
export function EmployeesNav({ active, canEdit }: { active: string; canEdit: boolean }) {
  return (
    <nav aria-label="Employees section" className="flex flex-wrap gap-1 border-b">
      {LINKS.filter((l) => !('editOnly' in l) || canEdit).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active === l.href ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            active === l.href
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
