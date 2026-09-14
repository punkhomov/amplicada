import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { LearningDocuments } from '../../contracts/index.js';
import { hrLearningCourses } from '../schemas/index.js';

/** Группа карточки под контент курса. `DocumentGroups` перечисляет общие для платформы — этой там нет. */
const LEARNING_CONTENT_GROUP = 'learning-content';

export function registerCourseDocuments(docs: DocumentRegistry): void {
  docs.register(LearningDocuments.COURSE, {
    module: 'hr-learning',
    label: 'hr-learning:course_label',
    creatable: true,
    deletable: true,
    softDelete: true,
  });

  docs.objects.extend(LearningDocuments.COURSE, {
    module: 'hr-learning',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'hr-learning:field_code', widget: 'text', required: true, helpText: 'hr-learning:field_code_help' },
      title: { label: 'hr-learning:field_title', widget: 'text', required: true },
      description: { label: 'hr-learning:field_description', widget: 'text' },
      active: { label: 'hr-learning:field_active', widget: 'checkbox', default: true, helpText: 'hr-learning:field_active_help' },
      selfEnrollable: {
        label: 'hr-learning:field_self_enrollable',
        widget: 'checkbox',
        default: true,
        helpText: 'hr-learning:field_self_enrollable_help',
      },
    },
    schema: hrLearningCourses,
    idColumn: 'id',
  });

  // Своя группа, а не `DEFAULT`: контент — это отдельный разговор от полей курса, и панель с
  // таблицей версий рядом с «Код» и «Название» читалась бы как их продолжение.
  docs.objects.registerGroup(LEARNING_CONTENT_GROUP, {
    document: LearningDocuments.COURSE,
    page: DocumentPages.DEFAULT,
    label: 'hr-learning:group_content',
    order: 1,
  });

  // Контент курса — отдельным расширением: своей таблицы у него нет, это версии из `packages`.
  // Без `schema` и без `save` рантайм вообще не пытается его сохранять — читается и только.
  //
  // Целиком кастомный компонент, а не набор readonly-полей: заливка файла, история версий и выбор
  // текущей в поля не укладываются, а показывать одну последнюю версию текстом значило бы прятать
  // от админа ровно то, ради чего история и заведена.
  docs.objects.extend(LearningDocuments.COURSE, {
    module: 'hr-learning',
    key: 'package',
    layout: {
      [DocumentPages.DEFAULT]: { [LEARNING_CONTENT_GROUP]: { rows: [[{ component: 'learning-course-package' }]] } },
    },
    // `load` пустой намеренно: панель ходит за версиями в `/api/learning/...` сама и опрашивает
    // статус, пока идёт распаковка. Отдавать те же данные вторым путём значило бы завести второй
    // источник правды, который разъедется при первом же опросе.
  });

  docs.lists.extend(LearningDocuments.COURSE, {
    module: 'hr-learning',
    schema: hrLearningCourses,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr-learning:field_code', type: 'text', size: 180 },
      title: { label: 'hr-learning:field_title', type: 'text', size: 280 },
      active: { label: 'hr-learning:field_active', type: 'checkbox', size: 100 },
      selfEnrollable: { label: 'hr-learning:field_self_enrollable', type: 'checkbox', size: 140 },
      createdAt: { label: 'hr-learning:field_created', type: 'datetime', size: 180 },
    },
  });
}
