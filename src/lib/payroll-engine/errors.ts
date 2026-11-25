/** A statutory rule needed for this calculation has no active, approved version. */
export class MissingRuleError extends Error {
  override name = 'MissingRuleError';
  constructor(
    public readonly rule: string,
    detail?: string,
  ) {
    super(`No active approved ${rule} rule${detail ? `: ${detail}` : ''}`);
  }
}

/** The engine input failed validation. */
export class InvalidInputError extends Error {
  override name = 'InvalidInputError';
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}: ${issues.join('; ')}` : message);
  }
}
