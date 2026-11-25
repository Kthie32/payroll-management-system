export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/**
 * Structural diff of two JSON values. Objects are compared key by key (sorted), arrays index by
 * index. Leaf differences are reported with a dotted path; `null`/`undefined` roots mean
 * "did not exist" (creation or deletion).
 */
export function diffJson(before: unknown, after: unknown, path = ''): DiffEntry[] {
  if (before === undefined) before = null;
  if (after === undefined) after = null;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => {
      const p = joinPath(path, k);
      if (!(k in before)) return [{ path: p, kind: 'added' as const, after: after[k] }];
      if (!(k in after)) return [{ path: p, kind: 'removed' as const, before: before[k] }];
      return diffJson(before[k], after[k], p);
    });
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const len = Math.max(before.length, after.length);
    const out: DiffEntry[] = [];
    for (let i = 0; i < len; i++) {
      const p = joinPath(path, i);
      if (i >= before.length) out.push({ path: p, kind: 'added', after: after[i] });
      else if (i >= after.length) out.push({ path: p, kind: 'removed', before: before[i] });
      else out.push(...diffJson(before[i], after[i], p));
    }
    return out;
  }

  if (Object.is(before, after)) return [];
  const p = path || '(root)';
  if (before === null) return [{ path: p, kind: 'added', after }];
  if (after === null) return [{ path: p, kind: 'removed', before }];
  return [{ path: p, kind: 'changed', before, after }];
}
