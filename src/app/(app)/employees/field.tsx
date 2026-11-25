import { Label } from '@/components/ui/label';

/** Label + control + error/hint, shared by the employee-area forms. */
export function Field({
  name,
  label,
  error,
  hint,
  className,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `space-y-2 ${className}` : 'space-y-2'}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Picks the value to show: what was just submitted (after a failed save), else the default. */
export function pick(values: Record<string, string> | undefined, name: string, fallback: string) {
  return values && name in values ? (values[name] ?? fallback) : fallback;
}
