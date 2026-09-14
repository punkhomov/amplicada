import { AlertTriangle } from 'lucide-react';
import { getErrorMessage } from '../lib/query-error.js';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert.js';
import { Button } from '../ui/button.js';

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="p-8 flex flex-col items-center gap-3 text-center">
      <Alert variant="destructive" className="max-w-md text-left">
        <AlertTriangle />
        <AlertTitle>Не удалось загрузить данные</AlertTitle>
        <AlertDescription>{getErrorMessage(error)}</AlertDescription>
      </Alert>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}
