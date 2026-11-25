/** Fields never written to the audit log in clear text. */
const REDACTED_KEYS = new Set(['passwordHash', 'totpSecretEnc', 'password', 'temporaryPassword']);
const REDACTED = '[REDACTED]';

function isRedactedKey(key: string): boolean {
  return REDACTED_KEYS.has(key) || key.endsWith('Enc');
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/**
 * Convert an arbitrary value into JSON-safe data for the audit log:
 * bigint → string, Date → ISO string, Decimal-like → string, secrets redacted.
 */
export function toAuditJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toAuditJson);
  if (typeof value === 'object') {
    // Prisma.Decimal and similar expose toFixed/toString
    if ('toFixed' in value && typeof (value as { toString: unknown }).toString === 'function') {
      return (value as { toString(): string }).toString();
    }
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = isRedactedKey(k) ? (v === null ? null : REDACTED) : toAuditJson(v);
    }
    return out;
  }
  return String(value);
}
