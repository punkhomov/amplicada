import { useEffect, useRef, useState } from 'react';
import type { RendererProps } from '../../contracts/index.js';
import { PreviewLoader } from '../components/preview-loader.js';
import ExternalRenderer from './external.js';

type Status = 'loading' | 'ready' | 'error';

/** Ленивый рендерер XLSX: Rust/WASM-парсер, Canvas-сетка с вкладками листов. */
export default function SpreadsheetRenderer(props: RendererProps) {
  const { readBytes, url } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const readRef = useRef(readBytes);
  readRef.current = readBytes;
  const [status, setStatus] = useState<Status>('loading');

  // biome-ignore lint/correctness/useExhaustiveDependencies: url — ключ перезагрузки, а readBytes берём из ref, чтобы новая ссылка на source не перезапускала загрузку
  useEffect(() => {
    let alive = true;
    let viewer: { destroy(): void } | null = null;
    setStatus('loading');
    (async () => {
      const { XlsxViewer } = await import('@silurus/ooxml/xlsx');
      const bytes = await readRef.current();
      if (!alive || !hostRef.current) return;
      const instance = new XlsxViewer(hostRef.current);
      viewer = instance;
      await instance.load(bytes);
      if (alive) setStatus('ready');
    })().catch(() => {
      if (alive) setStatus('error');
    });
    return () => {
      alive = false;
      viewer?.destroy();
    };
  }, [url]);

  if (status === 'error') return <ExternalRenderer {...props} />;

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {status === 'loading' && <PreviewLoader />}
    </div>
  );
}
