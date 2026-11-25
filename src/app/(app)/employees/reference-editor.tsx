'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from './actions';

export interface RefField {
  name: string;
  label: string;
  maxLength: number;
  required?: boolean;
  mono?: boolean;
}

type RefAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** "Add" form for a simple reference list (departments, banks). */
export function RefCreateForm({ fields, save }: { fields: RefField[]; save: RefAction }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(save, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] sm:items-end">
        {fields.map((f) => (
          <div key={f.name} className="space-y-2">
            <Label htmlFor={`new-${f.name}`}>{f.label}</Label>
            <Input
              id={`new-${f.name}`}
              name={f.name}
              required={f.required}
              maxLength={f.maxLength}
              defaultValue={state.values?.[f.name] ?? ''}
            />
          </div>
        ))}
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
    </form>
  );
}

/** One row of a reference list, with inline edit and delete. */
export function RefRow({
  id,
  fields,
  values,
  usage,
  canEdit,
  save,
  remove,
  noun,
}: {
  id: string;
  fields: RefField[];
  values: Record<string, string>;
  usage: string;
  canEdit: boolean;
  save: RefAction;
  remove: RefAction;
  noun: string;
}) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const r = await save(prev, fd);
      if (!r.error) setEditing(false);
      return r;
    },
    {},
  );
  const [delState, delAction, deleting] = useActionState<ActionState, FormData>(remove, {});

  if (editing) {
    return (
      <li className="space-y-2 py-3">
        <form action={saveAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          {fields.map((f) => (
            <div key={f.name} className="min-w-40 flex-1 space-y-1">
              <Label htmlFor={`${id}-${f.name}`} className="text-xs">
                {f.label}
              </Label>
              <Input
                id={`${id}-${f.name}`}
                name={f.name}
                required={f.required}
                maxLength={f.maxLength}
                defaultValue={saveState.values?.[f.name] ?? values[f.name] ?? ''}
                className="h-8"
              />
            </div>
          ))}
          <Button type="submit" size="sm" disabled={saving}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
        <FormMessage message={saveState.error} />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium">{values[fields[0]?.name ?? ''] ?? ''}</p>
        <p className="text-xs text-muted-foreground">
          {fields
            .slice(1)
            .map((f) => (values[f.name] ? `${f.label}: ${values[f.name]}` : null))
            .filter(Boolean)
            .concat(usage)
            .join(' · ')}
        </p>
        {delState.error ? <p className="mt-1 text-xs text-destructive">{delState.error}</p> : null}
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <form action={delAction}>
            <input type="hidden" name="id" value={id} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={deleting}
              onClick={(e) => {
                if (!window.confirm(`Delete this ${noun}?`)) e.preventDefault();
              }}
            >
              Delete
            </Button>
          </form>
        </div>
      ) : null}
      {saveState.message ? <span className="sr-only">{saveState.message}</span> : null}
    </li>
  );
}
