import type { RendererProps } from '../../contracts/index.js';
import { PreviewLoader } from '../components/preview-loader.js';

export default function AudioRenderer({ descriptor, url }: RendererProps) {
  if (!url) return <PreviewLoader />;
  return (
    <div className="grid h-full w-full place-items-center p-8">
      {/* biome-ignore lint/a11y/useMediaCaption: пользовательские файлы, дорожек субтитров у них может не быть */}
      <audio src={url} controls className="w-full max-w-xl" />
      <span className="sr-only">{descriptor.name}</span>
    </div>
  );
}
