import { redirect } from 'next/navigation';

/** Banks and mobile money providers are managed by the System Admin at /admin/banks. */
export default function EmployeesBanksRedirect() {
  redirect('/admin/banks');
}
