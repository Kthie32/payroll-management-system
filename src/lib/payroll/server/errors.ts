/** A user-facing failure of a payroll action (shown as the form error). */
export class RunActionError extends Error {
  override name = 'RunActionError';
}
