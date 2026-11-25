'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FREQUENCY_LABELS } from '@/lib/settings/components';
import {
  createPayGroupAction,
  deletePayGroupAction,
  updatePayGroupAction,
  type PayGroupState,
} from './actions';

type Frequency = keyof typeof FREQUENCY_LABELS;

function FrequencySelect({
  id,
  defaultValue,
  disabled,
}: {
  id: string;
  defaultValue: Frequency;
  disabled?: boolean;
}) {
  return (
    <NativeSelect id={id} name="frequency" defaultValue={defaultValue} disabled={disabled}>
      {Object.entries(FREQUENCY_LABELS).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </NativeSelect>
  );
}

export function CreatePayGroupForm() {
  const [state, action, pending] = useActionState<PayGroupState, FormData>(createPayGroupAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="new-name">Name</Label>
          <Input id="new-name" name="name" required maxLength={120} placeholder="e.g. Site Casuals" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-frequency">Frequency</Label>
          <FrequencySelect id="new-frequency" defaultValue="MONTHLY" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add pay group'}
        </Button>
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
    </form>
  );
}

export function EditPayGroupForm({
  group,
  frequencyLocked,
  deletable,
}: {
  group: { id: string; name: string; frequency: Frequency };
  frequencyLocked: boolean;
  deletable: boolean;
}) {
  const [state, action, pending] = useActionState<PayGroupState, FormData>(updatePayGroupAction, {});
  const [delState, delAction, deleting] = useActionState<PayGroupState, FormData>(
    deletePayGroupAction,
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={group.id} />
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
        <Input aria-label="Name" name="name" defaultValue={group.name} required maxLength={120} />
        {frequencyLocked ? (
          <>
            <input type="hidden" name="frequency" value={group.frequency} />
            <FrequencySelect id={`f-${group.id}`} defaultValue={group.frequency} disabled />
          </>
        ) : (
          <FrequencySelect id={`f-${group.id}`} defaultValue={group.frequency} />
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Save
          </Button>
          {deletable ? (
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              formAction={delAction}
              disabled={deleting}
              onClick={(e) => {
                if (!confirm(`Delete “${group.name}”?`)) e.preventDefault();
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </div>
      <FormMessage message={state.error ?? delState.error} />
      <FormMessage message={state.message} tone="success" />
    </form>
  );
}
