import type { RendererProps } from '../../contracts/index.js';
import { PreviewLoader } from '../components/preview-loader.js';

export default function PdfRenderer({ descriptor, url }: RendererProps) {
  if (!url) return <PreviewLoader />;
  return <iframe src={url} title={descriptor.name} className="h-full w-full border-0" />;
}
