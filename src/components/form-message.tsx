import { cn } from '@/lib/utils';

export function FormMessage({
  message,
  tone = 'error',
}: {
  message?: string | null;
  tone?: 'error' | 'success';
}) {
  if (!message) return null;
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md px-3 py-2 text-sm',
        tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
      )}
    >
      {message}
    </p>
  );
}
