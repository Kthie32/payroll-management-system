import { diffJson } from '@/lib/audit/diff';
import { cn } from '@/lib/utils';

function show(v: unknown): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const entries = diffJson(before, after);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No field changes recorded.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pr-3 font-medium">Field</th>
          <th className="py-1 pr-3 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {entries.map((e) => (
          <tr key={e.path} className="border-t align-top">
            <td className="py-1 pr-3">{e.path}</td>
            <td className={cn('break-all py-1 pr-3', e.kind !== 'added' && 'text-destructive')}>
              {e.kind === 'added' ? '—' : show(e.before)}
            </td>
            <td className={cn('break-all py-1', e.kind !== 'removed' && 'text-success')}>
              {e.kind === 'removed' ? '—' : show(e.after)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
