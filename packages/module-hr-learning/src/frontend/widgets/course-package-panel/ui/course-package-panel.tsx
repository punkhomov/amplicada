import { useDocumentCardContext } from '@amplicada/module-admin/frontend';
import { getErrorMessage, useApiClient, useMutation, useQuery, useQueryClient } from '@amplicada/platform-core/frontend';
import { Alert, AlertDescription } from '@amplicada/platform-core/frontend/ui/alert';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Progress } from '@amplicada/platform-core/frontend/ui/progress';
import { Spinner } from '@amplicada/platform-core/frontend/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { CircleAlert, Play, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  isPackageSettled,
  type PackageKind,
  type PackageNote,
  type PackageStatus,
  type PackageSummary,
} from '../../../../contracts/index.js';
import { uploadPackage } from '../lib/upload-package.js';

/** Пока есть незавершённый пакет — переспрашиваем: распаковку делает воркер, событий он не шлёт. */
const POLL_INTERVAL_MS = 2000;

/** У архива до распаковки значение — догадка по расширению; настоящее проставляет разбор манифеста. */
const KIND_LABELS: Record<PackageKind, string> = {
  scorm12: 'SCORM 1.2',
  scorm2004: 'SCORM 2004',
  file: 'Файл',
};

const STATUS_LABELS: Record<PackageStatus, string> = {
  pending: 'В очереди',
  processing: 'Распаковка',
  ready: 'Готов',
  failed: 'Ошибка',
};

/**
 * Панель контента курса на карточке документа: заливка пакета, история версий, выбор текущей.
 *
 * Живёт вне общего «Сохранить» карточки намеренно. Заливка — побочный эффект с файлом в сотни
 * мегабайт и фоновой распаковкой после; втянуть её в транзакцию сохранения документа нечем, да и
 * не нужно: версии пакета и поля курса меняются независимо друг от друга.
 */
export function CoursePackagePanel() {
  const { documentId: courseId, isNew } = useDocumentCardContext();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const queryKey = ['learning', 'packages', courseId];
  const { data, isLoading, error } = useQuery<{ packages: PackageSummary[] }>({
    queryKey,
    queryFn: () => api.get<{ packages: PackageSummary[] }>(`/learning/courses/${courseId}/packages`),
    // Без курса запрашивать нечего: id появится только после первого сохранения.
    enabled: !!courseId,
    refetchInterval: query => {
      const packages = query.state.data?.packages ?? [];
      return packages.some(pkg => !isPackageSettled(pkg.status)) ? POLL_INTERVAL_MS : false;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!courseId) throw new Error('Курс ещё не сохранён');
      setProgress(0);
      return uploadPackage({ baseUrl: api.baseUrl, courseId, file, onProgress: setProgress });
    },
    onSettled: () => {
      setProgress(null);
      // Обновляем и после отказа: строка пакета заводится до заливки, и при обрыве она осталась.
      invalidate();
    },
    onSuccess: () => {
      setChosen(null);
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  const makeCurrent = useMutation({
    mutationFn: (packageId: string) => api.post(`/learning/packages/${packageId}/current`),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (packageId: string) => api.delete(`/learning/packages/${packageId}`),
    onSuccess: invalidate,
  });

  if (isNew || !courseId) {
    return (
      <Alert>
        <CircleAlert className="size-4" />
        <AlertDescription>Сохраните курс — после этого появится загрузка пакета. Версии привязываются к курсу по id.</AlertDescription>
      </Alert>
    );
  }

  const packages = data?.packages ?? [];
  const busy = upload.isPending;
  const failure = upload.error ?? makeCurrent.error ?? remove.error ?? error;
  const playable = packages.some(pkg => pkg.isCurrent && pkg.status === 'ready');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={inputRef}
          type="file"
          className="h-9 max-w-md"
          disabled={busy}
          onChange={event => setChosen(event.target.files?.[0] ?? null)}
        />
        <Button size="sm" disabled={!chosen || busy} onClick={() => chosen && upload.mutate(chosen)}>
          <Upload className="size-4" />
          Загрузить
        </Button>
        {/*
          Временная дверь в плеер. Каталога и назначения курсов пока нет, а проверять залитый пакет
          как-то надо — открываем от своего имени, новой вкладкой, чтобы не терять карточку.
        */}
        {playable && (
          <Button size="sm" variant="secondary" onClick={() => window.open(`/learning/play/${courseId}`, '_blank', 'noopener')}>
            <Play className="size-4" />
            Открыть плеер
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        ZIP принимается как SCORM-пакет (1.2 или 2004 — версию определит распаковка), любой другой файл — как одиночный материал (PDF,
        видео) с отметкой «ознакомлен».
      </p>

      {busy && (
        <div className="flex items-center gap-3">
          {/* Прогресс — только про отправку. Распаковка идёт уже на сервере, и её длительность
              отсюда не видна: там показывается статус пакета в таблице. */}
          <Progress value={progress === null ? null : Math.round(progress * 100)} className="max-w-md" />
          <span className="text-xs text-muted-foreground tabular-nums">
            {progress === null ? 'Отправка…' : `${Math.round(progress * 100)}%`}
          </span>
        </div>
      )}

      {failure && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertDescription>{getErrorMessage(failure)}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка версий…</p>
      ) : packages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Контента ещё нет</EmptyTitle>
            <EmptyDescription>Загрузите первый пакет — он станет текущим автоматически.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Версия</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Формат</TableHead>
              <TableHead>Название из пакета</TableHead>
              <TableHead className="text-right">Файлов</TableHead>
              <TableHead className="text-right">Объём</TableHead>
              <TableHead>Загружен</TableHead>
              <TableHead className="w-48" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map(pkg => (
              <TableRow key={pkg.id}>
                <TableCell className="font-medium tabular-nums">{pkg.version}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={pkg.status === 'failed' ? 'destructive' : pkg.status === 'ready' ? 'default' : 'secondary'}>
                      {STATUS_LABELS[pkg.status]}
                    </Badge>
                    {pkg.isCurrent && <Badge variant="outline">текущий</Badge>}
                  </div>
                  {/* Текст сбоя показываем прямо здесь: иначе за причиной пришлось бы идти в логи. */}
                  {pkg.error && <p className="mt-1 text-xs text-destructive">{pkg.error}</p>}
                  <PackageNotes notes={pkg.notes} />
                  {/* Пакет, который сейчас в работе, показывает хотя бы то, что работа идёт: до этого
                      «В очереди» без единого числа выглядело как «ничего не происходит». */}
                  {!isPackageSettled(pkg.status) && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Spinner className="size-3" />
                      {pkg.status === 'pending' ? 'Ждёт воркер распаковки' : 'Файлы раскладываются в хранилище'}
                    </p>
                  )}
                </TableCell>
                {/*
                  Каким рантаймом пакет проигрывается — не справка, а первое, что нужно при
                  «курс не находит window.API»: 1.2 ищет `API`, 2004 — `API_1484_11`, и ошибка
                  выглядит одинаково в обе стороны. Рядом версия схемы прямо из манифеста.
                */}
                <TableCell className="text-sm">
                  <span className="text-muted-foreground">{KIND_LABELS[pkg.kind]}</span>
                  {pkg.scormVersion && <span className="ml-1 text-xs text-muted-foreground/70">{pkg.scormVersion}</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{pkg.title ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{pkg.totalFiles || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(pkg.totalSize)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(pkg.createdAt).toLocaleString()}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {pkg.status === 'ready' && !pkg.isCurrent && (
                      <Button size="sm" variant="secondary" disabled={makeCurrent.isPending} onClick={() => makeCurrent.mutate(pkg.id)}>
                        Сделать текущим
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Удалить версию ${pkg.version}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(pkg.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * Замечания к принятому пакету. Свёрнуты, потому что их бывает много одного сорта — десяток `.psd`
 * от дизайнера, — но счётчик виден всегда: «Готов» без единого слова о выброшенных файлах и был тем,
 * из-за чего непонятно, что вообще произошло с пакетом.
 */
function PackageNotes({ notes }: { notes: PackageNote[] }) {
  if (!notes.length) return null;

  const skipped = notes.filter(note => note.kind === 'skipped-file').length;
  const summary = [skipped && `${skipped} файл(ов) не принято`, notes.length - skipped && `${notes.length - skipped} замечание(й) разбора`]
    .filter(Boolean)
    .join(', ');

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-amber-600 dark:text-amber-500">{summary}</summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {notes.map(note => (
          <li key={`${note.kind}:${note.location}:${note.message}`} className="text-xs text-muted-foreground">
            {note.message}
            {note.location && <span className="ml-1 font-mono opacity-70">{note.location}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
