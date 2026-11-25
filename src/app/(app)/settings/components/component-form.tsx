'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CALC_LABELS, KIND_LABELS } from '@/lib/settings/components';
import {
  createComponentAction,
  deleteComponentAction,
  updateComponentAction,
  type ComponentFormState,
} from './actions';

export interface ComponentValues {
  id?: string;
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'RATE_X_QTY';
  taxable: boolean;
  nssfable: boolean;
  prorate: boolean;
  recurring: boolean;
  isActive: boolean;
  priority: number;
  sortOrder: number;
}

export function ComponentForm({
  initial,
  canEdit,
  inUse = false,
}: {
  initial: ComponentValues;
  canEdit: boolean;
  inUse?: boolean;
}) {
  const isNew = !initial.id;
  const [state, action, pending] = useActionState<ComponentFormState, FormData>(
    isNew ? createComponentAction : updateComponentAction,
    {},
  );
  const [kind, setKind] = useState(initial.kind);
  const disabled = !canEdit || pending;
  const isEarning = kind === 'EARNING';

  return (
    <form action={action} className="space-y-6">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <fieldset disabled={disabled} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              defaultValue={initial.code}
              required
              maxLength={40}
              disabled={!isNew || disabled}
              className="font-mono uppercase"
              aria-describedby="code-help"
            />
            <p id="code-help" className="text-xs text-muted-foreground">
              {isNew
                ? 'Letters, digits and _. Cannot be changed later; it appears on payslips and exports.'
                : 'Codes cannot be changed after creation.'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={initial.name} required maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kind">Kind</Label>
            <NativeSelect
              id="kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ComponentValues['kind'])}
            >
              {Object.entries(KIND_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="calcType">Calculation</Label>
            <NativeSelect id="calcType" name="calcType" defaultValue={initial.calcType}>
              {Object.entries(CALC_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Deduction priority</Label>
            <Input
              id="priority"
              name="priority"
              type="number"
              min={0}
              max={9999}
              defaultValue={initial.priority}
              required
              aria-describedby="priority-help"
            />
            <p id="priority-help" className="text-xs text-muted-foreground">
              Lower numbers are deducted first when pay is not enough for all deductions.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sortOrder">Display order</Label>
            <Input
              id="sortOrder"
              name="sortOrder"
              type="number"
              min={0}
              max={9999}
              defaultValue={initial.sortOrder}
              required
            />
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Treatment</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Check name="taxable" label="Taxable (counts for PAYE)" defaultChecked={initial.taxable} disabled={!isEarning} />
            <Check name="nssfable" label="Subject to NSSF" defaultChecked={initial.nssfable} disabled={!isEarning} />
            <Check name="prorate" label="Prorate for part-period employment" defaultChecked={initial.prorate} />
            <Check name="recurring" label="Recurring every period" defaultChecked={initial.recurring} />
            <Check name="isActive" label="Active" defaultChecked={initial.isActive} />
          </div>
          {!isEarning ? (
            <p className="text-xs text-muted-foreground">
              Taxable and NSSF only apply to earnings, so they are switched off for this kind.
            </p>
          ) : null}
        </fieldset>
      </fieldset>

      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : isNew ? 'Create component' : 'Save changes'}
          </Button>
        </div>
      ) : null}
      {canEdit && !isNew && !inUse ? <DeleteComponent id={initial.id!} /> : null}
    </form>
  );
}

function DeleteComponent({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ComponentFormState, FormData>(
    deleteComponentAction,
    {},
  );
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm text-muted-foreground">
        This component has never been used, so it can be deleted.
      </p>
      <FormMessage message={state.error} />
      <Button
        type="submit"
        formAction={action}
        name="id"
        value={id}
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={(e) => {
          if (!confirm('Delete this component permanently?')) e.preventDefault();
        }}
      >
        Delete component
      </Button>
    </div>
  );
}

function Check({
  name,
  label,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm has-[:disabled]:opacity-60">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}
