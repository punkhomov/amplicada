import { registerComponent } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { moduleManifest } from '../contracts/manifest.js';
import { CoursePlayerPage } from './pages/course-player/index.js';
import { CoursePackagePanel } from './widgets/course-package-panel/index.js';

export const hrLearningFrontendModule: FrontendModule = {
  ...moduleManifest,

  setup(context) {
    // Панель контента на карточке документа «Курс» (component-ключ из backend/documents/course.ts).
    registerComponent('learning-course-package', CoursePackagePanel);

    // Плеер без loader'а: запуск — это POST, заводящий попытку, и делать его до перехода на страницу
    // значило бы создавать попытку у того, кто до курса так и не дошёл.
    context.routes.register('/learning/play/:courseId', <CoursePlayerPage />, { layout: 'app' });

    // Каталога и назначения курсов пока нет — в плеер попадают с карточки курса в админке (подплан 06).
  },
};
