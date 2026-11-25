import { Construction } from 'lucide-react';

export function ComingSoon({ title, phase, what }: { title: string; phase: number; what: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-16 text-center">
        <Construction className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-lg font-medium">Coming in Phase {phase}</p>
        <p className="max-w-md text-sm text-muted-foreground">{what}</p>
      </div>
    </div>
  );
}
