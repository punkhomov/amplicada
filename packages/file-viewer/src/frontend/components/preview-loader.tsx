import { LoaderCircle } from 'lucide-react';

export function PreviewLoader() {
  return (
    <div className="grid h-full w-full place-items-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
