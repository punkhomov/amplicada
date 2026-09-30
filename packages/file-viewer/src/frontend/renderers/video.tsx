import type { RendererProps } from '../../contracts/index.js';
import { PreviewLoader } from '../components/preview-loader.js';

export default function VideoRenderer({ descriptor, url }: RendererProps) {
  if (!url) return <PreviewLoader />;
  return (
    <div className="flex h-full w-full items-center justify-center bg-black/90">
      {/* biome-ignore lint/a11y/useMediaCaption: пользовательские файлы, дорожек субтитров у них может не быть */}
      <video src={url} controls className="max-h-full max-w-full" />
      <span className="sr-only">{descriptor.name}</span>
    </div>
  );
}
