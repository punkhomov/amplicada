import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import type { RendererProps } from '../../contracts/index.js';
import { useFileViewer } from '../components/labels.js';
import { PreviewLoader } from '../components/preview-loader.js';
import { useZoomPan } from '../lib/use-zoom-pan.js';

export default function ImageRenderer({ descriptor, url }: RendererProps) {
  const { labels } = useFileViewer();
  const zoom = useZoomPan();

  if (!url) return <PreviewLoader />;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={zoom.containerRef}
        role="application"
        aria-label={descriptor.name}
        className="absolute inset-0 flex items-center justify-center"
        onPointerDown={zoom.onPointerDown}
        onPointerMove={zoom.onPointerMove}
        onPointerUp={zoom.onPointerUp}
        onDoubleClick={zoom.onDoubleClick}
      >
        <img
          src={url}
          alt={descriptor.name}
          draggable={false}
          style={zoom.contentStyle}
          className="max-h-full max-w-full select-none object-contain"
        />
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background/90 px-1 py-0.5 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" onClick={zoom.zoomOut} disabled={!zoom.isZoomed} title={labels.zoomOut}>
          <ZoomOut className="size-4" />
        </Button>
        <span className="min-w-11 text-center text-xs tabular-nums">{Math.round(zoom.scale * 100)}%</span>
        <Button variant="ghost" size="icon-sm" onClick={zoom.zoomIn} title={labels.zoomIn}>
          <ZoomIn className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={zoom.reset} disabled={!zoom.isZoomed} title={labels.zoomReset}>
          <Maximize className="size-4" />
        </Button>
      </div>
    </div>
  );
}
