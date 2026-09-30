import { lazy } from 'react';
import type { RendererPlugin } from '../../contracts/index.js';
import { fileKindOf } from '../lib/file-kind.js';

const imageRenderer: RendererPlugin = {
  id: 'image',
  match: descriptor => fileKindOf(descriptor) === 'image',
  component: lazy(() => import('./image.js')),
  capabilities: { zoom: true },
};

const videoRenderer: RendererPlugin = {
  id: 'video',
  match: descriptor => fileKindOf(descriptor) === 'video',
  component: lazy(() => import('./video.js')),
};

const audioRenderer: RendererPlugin = {
  id: 'audio',
  match: descriptor => fileKindOf(descriptor) === 'audio',
  component: lazy(() => import('./audio.js')),
};

const pdfRenderer: RendererPlugin = {
  id: 'pdf',
  match: descriptor => fileKindOf(descriptor) === 'pdf',
  component: lazy(() => import('./pdf.js')),
};

const textRenderer: RendererPlugin = {
  id: 'text',
  match: descriptor => fileKindOf(descriptor) === 'text',
  component: lazy(() => import('./text.js')),
  capabilities: { edit: true },
};

const wordRenderer: RendererPlugin = {
  id: 'word',
  match: descriptor => fileKindOf(descriptor) === 'word',
  component: lazy(() => import('./word.js')),
};

const spreadsheetRenderer: RendererPlugin = {
  id: 'spreadsheet',
  match: descriptor => fileKindOf(descriptor) === 'spreadsheet',
  component: lazy(() => import('./spreadsheet.js')),
};

/** Ловит всё остальное — с самым низким приоритетом, поэтому проверяется последним. */
export const externalRenderer: RendererPlugin = {
  id: 'external',
  match: () => true,
  component: lazy(() => import('./external.js')),
  priority: -100,
};

export const defaultRenderers: RendererPlugin[] = [
  imageRenderer,
  videoRenderer,
  audioRenderer,
  pdfRenderer,
  textRenderer,
  wordRenderer,
  spreadsheetRenderer,
  externalRenderer,
];
