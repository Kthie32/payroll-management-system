'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { type ActionState, createEmployeeAction, updateEmployeeAction } from './actions';
import { Field, pick } from './field';
import { RESIDENCY_LABELS, WORKER_TYPE_LABELS } from './labels';

export interface EmployeeFormDefaults {
  staffNo: string;
  firstName: string;
  lastName: string;
  otherNames: string;
  workerType: string;
  payGroupId: string;
  departmentId: string;
  jobTitle: string;
  grade: string;
  hireDate: string;
  residency: string;
  tin: string;
  nssfNo: string;
  lstDistrict: string;
  payeApplicable: boolean;
  nssfApplicable: boolean;
  lstApplicable: boolean;
}

export const EMPTY_EMPLOYEE: EmployeeFormDefaults = {
  staffNo: '',
  firstName: '',
  lastName: '',
  otherNames: '',
  workerType: 'PERMANENT',
  payGroupId: '',
  departmentId: '',
  jobTitle: '',
  grade: '',
  hireDate: '',
  residency: 'RESIDENT',
  tin: '',
  nssfNo: '',
  lstDistrict: '',
  payeApplicable: true,
  nssfApplicable: true,
  lstApplicable: true,
};

interface Option {
  id: string;
  name: string;
}

export function EmployeeForm({
  employeeId,
  defaults,
  maskedNin,
  payGroups,
  departments,
}: {
  employeeId?: string;
  defaults: EmployeeFormDefaults;
  maskedNin?: string | null;
  payGroups: Option[];
  departments: Option[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    employeeId ? updateEmployeeAction : createEmployeeAction,
    {},
  );
  const fe = state.fieldErrors ?? {};

  const v = (name: keyof EmployeeFormDefaults) =>
    pick(state.values, name, String(defaults[name]));
  const checked = (name: 'payeApplicable' | 'nssfApplicable' | 'lstApplicable') =>
    state.values ? state.values[name] === 'on' : defaults[name];

  return (
    <form action={action} className="space-y-8">
      {employeeId ? <input type="hidden" name="employeeId" value={employeeId} /> : null}

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="staffNo" error={fe.staffNo} label="Staff number">
            <Input
              id="staffNo"
              name="staffNo"
              required
              maxLength={40}
              defaultValue={v('staffNo')}
              aria-invalid={Boolean(fe.staffNo)}
            />
          </Field>
          <Field name="firstName" error={fe.firstName} label="First name">
            <Input
              id="firstName"
              name="firstName"
              required
              maxLength={80}
              defaultValue={v('firstName')}
              aria-invalid={Boolean(fe.firstName)}
            />
          </Field>
          <Field name="lastName" error={fe.lastName} label="Last name">
            <Input
              id="lastName"
              name="lastName"
              required
              maxLength={80}
              defaultValue={v('lastName')}
              aria-invalid={Boolean(fe.lastName)}
            />
          </Field>
          <Field name="otherNames" error={fe.otherNames} label="Other names">
            <Input
              id="otherNames"
              name="otherNames"
              maxLength={120}
              defaultValue={v('otherNames')}
            />
          </Field>
          <Field
            name="nin"
            error={fe.nin}
            label="National ID (NIN)"
            hint={
              maskedNin
                ? `On file: ${maskedNin}. Leave blank to keep it.`
                : '14 letters or digits. Stored encrypted.'
            }
          >
            <Input
              id="nin"
              name="nin"
              maxLength={20}
              autoComplete="off"
              placeholder={maskedNin ?? 'e.g. CM90012345ABCD'}
              aria-invalid={Boolean(fe.nin)}
            />
          </Field>
          <Field name="residency" error={fe.residency} label="Tax residency">
            <NativeSelect id="residency" name="residency" defaultValue={v('residency')}>
              {Object.entries(RESIDENCY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Employment</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="workerType" error={fe.workerType} label="Worker type">
            <NativeSelect id="workerType" name="workerType" defaultValue={v('workerType')}>
              {Object.entries(WORKER_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="payGroupId" error={fe.payGroupId} label="Pay group">
            <NativeSelect
              id="payGroupId"
              name="payGroupId"
              required
              defaultValue={v('payGroupId')}
              aria-invalid={Boolean(fe.payGroupId)}
            >
              <option value="">Choose…</option>
              {payGroups.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="departmentId" error={fe.departmentId} label="Department">
            <NativeSelect id="departmentId" name="departmentId" defaultValue={v('departmentId')}>
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="jobTitle" error={fe.jobTitle} label="Job title">
            <Input id="jobTitle" name="jobTitle" maxLength={120} defaultValue={v('jobTitle')} />
          </Field>
          <Field name="grade" error={fe.grade} label="Grade">
            <Input id="grade" name="grade" maxLength={40} defaultValue={v('grade')} />
          </Field>
          <Field name="hireDate" error={fe.hireDate} label="Hire date">
            <Input
              id="hireDate"
              name="hireDate"
              type="date"
              required
              defaultValue={v('hireDate')}
              aria-invalid={Boolean(fe.hireDate)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Statutory</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="tin" error={fe.tin} label="TIN" hint="10 digits (URA).">
            <Input
              id="tin"
              name="tin"
              inputMode="numeric"
              maxLength={14}
              defaultValue={v('tin')}
              aria-invalid={Boolean(fe.tin)}
            />
          </Field>
          <Field name="nssfNo" error={fe.nssfNo} label="NSSF number">
            <Input
              id="nssfNo"
              name="nssfNo"
              maxLength={24}
              defaultValue={v('nssfNo')}
              aria-invalid={Boolean(fe.nssfNo)}
            />
          </Field>
          <Field name="lstDistrict" error={fe.lstDistrict} label="LST district">
            <Input
              id="lstDistrict"
              name="lstDistrict"
              maxLength={80}
              defaultValue={v('lstDistrict')}
            />
          </Field>
        </div>
        <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
          <legend className="sr-only">Statutory deductions that apply</legend>
          {(
            [
              ['payeApplicable', 'PAYE applies'],
              ['nssfApplicable', 'NSSF applies'],
              ['lstApplicable', 'LST applies'],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={name}
                defaultChecked={checked(name)}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </fieldset>
      </section>

      <FormMessage message={state.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : employeeId ? 'Save changes' : 'Create employee'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={employeeId ? `/employees/${employeeId}` : '/employees'}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
