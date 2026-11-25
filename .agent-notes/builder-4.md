# Builder 4 — shared-file changes needed (parent to apply)

## 1. Sidebar: add "Exports" (src/components/shell/nav-items.ts)

- Add `'exports'` to the `NavIcon` union.
- Insert after the Payroll item:
  `{ href: '/exports', label: 'Exports', icon: 'exports', permission: 'payroll.export' },`
- In `src/components/shell/sidebar.tsx`, map the `exports` icon (suggest lucide `Landmark` or `FileOutput`).

## 2. System admin access to bank file templates

SYSTEM_ADMIN holds `settings.edit` (needed to edit templates) but not `payroll.export`, so the
Exports nav item is hidden for them. `/exports/templates` accepts either permission. Suggest the
Settings page (Builder 2B) link to `/exports/templates` ("Bank file templates").

## 3. Employee detail link

`/exports/runs/[runId]` links missing-account employees to `/employees/{employeeId}` — assumes
Builder 2A's employee detail route is `/employees/[id]`. Adjust the link if different.

## 4. Company name setting

Bank file tokens use Setting key `company.name` (string, or `{ value: string }`). Falls back to
"Company". Builder 2B should create/edit it.
