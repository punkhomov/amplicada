// VitePress-конфиг спайка: один сайт из всех packages/*/docs без версионирования.
// Дерево content/packages/<pkg>/docs собирает assemble.mjs (gitignore).
// Base для GitHub Pages задаётся env DOCS_BASE (workflow ставит /amplicada/).
import { defineConfig } from 'vitepress';

const sidebarFor = (name, pages) => ({
  base: `/packages/${name}/docs/`,
  text: name,
  items: pages.map(([text, link]) => ({ text, link })),
});

export default defineConfig({
  title: 'Amplicada',
  description: 'Потребительская документация пакетов',
  lang: 'ru-RU',
  base: process.env.DOCS_BASE || '/',
  // Спайк: показать что есть, а не упасть на первой битой ссылке.
  // Перед продом — false + чистка (module-docs требует зелёную сборку).
  ignoreDeadUrls: true,
  themeConfig: {
    nav: [
      { text: 'Главная', link: '/' },
      { text: 'platform-core', link: '/packages/platform-core/docs/' },
      { text: 'module-admin', link: '/packages/module-admin/docs/' },
    ],
    sidebar: {
      '/packages/platform-core/docs/': sidebarFor('platform-core', [
        ['Обзор', ''],
        ['Справочник', 'reference/'],
        ['UI-кит', 'reference/ui-kit'],
        ['Точки расширения', 'reference/frontend-extension-points'],
        ['Storage', 'reference/storage'],
        ['Уведомления', 'reference/notifications'],
        ['How-to', 'how-to/'],
        ['Концепции', 'explanation/'],
      ]),
      '/packages/module-admin/docs/': sidebarFor('module-admin', [
        ['Обзор', ''],
        ['Справочник', 'reference/'],
        ['Интеграция действий', 'reference/composition'],
        ['Хранилище', 'reference/storage'],
        ['Шаблоны уведомлений', 'reference/notification-templates'],
      ]),
      '/packages/file-viewer/docs/': sidebarFor('file-viewer', [
        ['Обзор', ''],
        ['file-viewer', 'reference/file-viewer'],
      ]),
      '/packages/module-auth-password/docs/': sidebarFor('module-auth-password', [
        ['Обзор', ''],
        ['Справочник', 'reference/'],
        ['Интеграция с админкой', 'reference/composition'],
      ]),
      '/packages/module-support-chat/docs/': sidebarFor('module-support-chat', [
        ['Обзор', ''],
        ['Справочник', 'reference/'],
        ['API', 'reference/api'],
        ['Realtime', 'explanation/realtime'],
      ]),
      '/packages/module-notification-email/docs/': sidebarFor('module-notification-email', [
        ['Обзор', ''],
        ['Справочник', 'reference/'],
        ['Включение SMTP', 'how-to/enable-smtp'],
        ['Адрес пользователя', 'how-to/set-user-email'],
      ]),
      '/packages/application-tools/docs/': sidebarFor('application-tools', [
        ['Обзор', ''],
        ['Справочник', 'reference/'],
        ['Композиция', 'reference/composition'],
        ['Optional-интеграция', 'how-to/optional-module-integration'],
        ['Модель композиции', 'explanation/composition-model'],
      ]),
      // module-hr / module-workflow — плоские файлы без index.md (см. карту в ref/README).
      '/packages/module-hr/docs/': sidebarFor('module-hr', [
        ['Туториал', 'tutorial'],
        ['How-to', 'how-to'],
        ['Справочник', 'reference'],
        ['Концепция', 'explanation'],
      ]),
      '/packages/module-workflow/docs/': sidebarFor('module-workflow', [
        ['Туториал', 'tutorial'],
        ['How-to', 'how-to'],
        ['Справочник', 'reference'],
        ['Концепция', 'explanation'],
      ]),
    },
    search: { provider: 'local' },
    lastUpdated: false,
  },
});
