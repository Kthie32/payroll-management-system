import { NAV_ITEMS } from '@/components/shell/nav-items';
import { Sidebar } from '@/components/shell/sidebar';
import { can, requireUser, ROLE_LABELS } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = NAV_ITEMS.filter((i) => can(user.roles, i.permission));
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        items={items}
        userName={user.name}
        roleLabels={user.roles.map((r) => ROLE_LABELS[r])}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
