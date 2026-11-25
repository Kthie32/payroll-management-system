'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { saveInputsAction, type ActionState } from '../../../actions';

interface GridEmployee {
  id: string;
  staffNo: string;
  name: string;
}
interface GridComponent {
  id: string;
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  isQuantity: boolean;
}

export function InputsGrid({
  periodId,
  editable,
  employees,
  components,
  values,
}: {
  periodId: string;
  editable: boolean;
  employees: GridEmployee[];
  components: GridComponent[];
  values: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveInputsAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="periodId" value={periodId} />
      <div className="relative w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Employee
              </th>
              {components.map((c) => (
                <th key={c.id} className="min-w-28 px-2 py-2 text-left align-bottom">
                  <span className="block text-xs font-semibold">{c.code}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {c.isQuantity ? 'quantity' : 'amount'}
                    {c.kind === 'DEDUCTION'
                      ? ' · deduction'
                      : c.kind === 'EMPLOYER'
                        ? ' · employer'
                        : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1.5">
                  <span className="font-medium">{e.staffNo}</span>{' '}
                  <span className="text-muted-foreground">{e.name}</span>
                </td>
                {components.map((c) => {
                  const key = `${e.id}:${c.id}`;
                  return (
                    <td key={c.id} className="px-2 py-1">
                      <input
                        name={`cell:${key}`}
                        defaultValue={values[key] ?? ''}
                        inputMode={c.isQuantity ? 'decimal' : 'numeric'}
                        disabled={!editable}
                        aria-label={`${c.code} for ${e.staffNo}`}
                        className="h-8 w-full min-w-24 rounded-md border border-input bg-card px-2 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <div className="space-y-2 px-6 sm:px-0">
          <FormMessage message={state.error} />
          <FormMessage message={state.message} tone="success" />
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save inputs'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
