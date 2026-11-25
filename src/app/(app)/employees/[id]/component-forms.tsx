'use client';

import type { CalcType } from '@prisma/client';
import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { type ActionState, assignComponentAction, endComponentAction } from '../actions';
import { Field, pick } from '../field';

export interface AssignableComponent {
  id: string;
  code: string;
  name: string;
  kind: string;
  calcType: CalcType;
}

const VALUE_LABEL: Record<CalcType, { label: string; hint: string }> = {
  FIXED: { label: 'Amount (UGX)', hint: 'Whole shillings per pay period.' },
  PERCENT_OF_BASIC: { label: 'Percent of basic', hint: 'e.g. 12.5 for 12.5% of basic pay.' },
  RATE_X_QTY: {
    label: 'Rate per unit (UGX)',
    hint: 'Quantities (hours, days) are entered per pay period.',
  },
};

export function AssignComponentForm({
  employeeId,
  components,
  today,
}: {
  employeeId: string;
  components: AssignableComponent[];
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assignComponentAction, {});
  const fe = state.fieldErrors ?? {};
  const v = (name: string, fallback: string) => pick(state.values, name, fallback);
  const [componentId, setComponentId] = useState(v('componentId', ''));
  const selected = components.find((c) => c.id === componentId);
  const valueText = VALUE_LABEL[selected?.calcType ?? 'FIXED'];

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="componentId" label="Component" error={fe.componentId}>
          <NativeSelect
            id="componentId"
            name="componentId"
            required
            value={componentId}
            onChange={(e) => setComponentId(e.target.value)}
          >
            <option value="">Choose…</option>
            {(['EARNING', 'DEDUCTION', 'EMPLOYER'] as const).map((kind) => {
              const list = components.filter((c) => c.kind === kind);
              if (list.length === 0) return null;
              return (
                <optgroup key={kind} label={kind.charAt(0) + kind.slice(1).toLowerCase() + 's'}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </NativeSelect>
        </Field>
        <Field name="value" label={valueText.label} error={fe.value} hint={valueText.hint}>
          <Input
            id="value"
            name="value"
            required
            inputMode="decimal"
            defaultValue={v('value', '')}
          />
        </Field>
        <Field name="effectiveFrom" label="From" error={fe.effectiveFrom}>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={v('effectiveFrom', today)}
          />
        </Field>
        <Field name="effectiveTo" label="To (optional)" error={fe.effectiveTo} hint="Inclusive.">
          <Input
            id="effectiveTo"
            name="effectiveTo"
            type="date"
            defaultValue={v('effectiveTo', '')}
          />
        </Field>
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Assign component'}
      </Button>
    </form>
  );
}

export function EndComponentForm({
  employeeId,
  assignmentId,
  defaultDate,
}: {
  employeeId: string;
  assignmentId: string;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(endComponentAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        End
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Input
        name="effectiveTo"
        type="date"
        required
        defaultValue={defaultDate}
        aria-label="Last day this component applies"
        className="h-8 w-40"
      />
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state.error ? <p className="basis-full text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
