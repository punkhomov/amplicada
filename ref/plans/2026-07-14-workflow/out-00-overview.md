# Техническое задание: Платформа управления бизнес-процессами (BPM-Light)

**Версия:** 2.0 (Final MVP)  
**Дата:** 16 июля 2026  
**Стек:** Fastify (Node.js), React, TypeScript, PostgreSQL, React Flow.

---

## 1. Введение и Цели

### 1.1. Назначение системы
Создание легковесного, но гибкого движка для автоматизации внутренних процессов компании (заявки, согласования, оценки). Система должна позволять бизнес-пользователям (администраторам) самостоятельно проектировать процессы через визуальный редактор без вмешательства разработчиков.

### 1.2. Ключевые принципы архитектуры
1.  **Разделение логики и данных:** Ядро движка не знает о предметной области. Бизнес-логика (поиск руководителей, валидация бюджетов) реализуется через плагины (делегаты).
2.  **Динамические состояния:** Набор статусов и переходов не хардкодится, а определяется конфигурацией каждого конкретного процесса.
3.  **Версионность:** Изменение схемы процесса создает новую версию. Активные заявки продолжают работать по старой версии, новые — по новой. Автоматическая миграция старых заявок не производится.
4.  **Расширяемость:** Приложение «публикует» доступные делегаты через реестр, которые затем становятся доступны для выбора в визуальном редакторе.

---

## 2. Модель данных (PostgreSQL)

### 2.1. `workflows` (Шаблоны процессов)
Хранит метаинформацию о типах процессов.
```sql
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL, -- Уникальный код (напр. 'training_request')
    name VARCHAR(255) NOT NULL,
    description TEXT,
    current_version_id UUID, -- Ссылка на актуальную версию
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 2.2. `workflow_versions` (Версии схем)
Хранит JSON-конфигурацию графа, состояний и настроек нод.
```sql
CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id),
    version_number INT NOT NULL, -- 1, 2, 3...
    config JSONB NOT NULL, -- Полный конфиг: nodes, edges, state_machine rules
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workflow_id, version_number)
);
```

### 2.3. `process_instances` (Экземпляры процессов)
Конкретная заявка или задача, привязанная к строгой версии схемы.
```sql
CREATE TABLE process_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
    workflow_code VARCHAR(100) NOT NULL, -- Денормализация для фильтров
    
    current_state VARCHAR(100) NOT NULL, -- Текущий статус из конфига версии
    payload JSONB NOT NULL DEFAULT '{}', -- Данные заявки
    context JSONB NOT NULL DEFAULT '{}', -- Метаданные (author_id, dates и т.д.)
    
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
```

### 2.4. `tasks` (Инбокс пользователей)
Материализованное представление задач для быстрого поиска.
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_instance_id UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
    assignee_id UUID NOT NULL REFERENCES users(id),
    
    state VARCHAR(100) NOT NULL, -- Статус процесса в момент создания задачи
    status VARCHAR(50) DEFAULT 'pending', -- pending, completed, cancelled
    
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, status);
```

### 2.5. `audit_log` (История действий)
```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_instance_id UUID NOT NULL REFERENCES process_instances(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL, -- submit, approve, rework
    from_state VARCHAR(100),
    to_state VARCHAR(100),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

*(Таблица `users` предполагается существующей)*

---

## 3. Архитектура ядра (Backend)

### 3.1. Реестр плагинов (Plugin Registry)
Центральный компонент, связывающий ядро и бизнес-логику приложения.

**Интерфейсы:**
*   `IAssigneeProvider`: Определяет исполнителя задачи (`resolve(context)`).
*   `IValidatorProvider`: Проверяет данные перед переходом (`validate(payload)`).
*   `IServiceTaskProvider`: Выполняет автоматические действия (`execute(payload)`).

**Принцип работы:**
При старте приложения регистрируются доступные делегаты. API `/api/admin/builder/meta` отдает список этих делегатов фронтенду для использования в редакторе.

### 3.2. Workflow Engine (Движок)
*   **Интерпретатор:** При каждом действии над процессом загружает `config` из `workflow_versions` по ID версии экземпляра.
*   **State Machine:** Использует библиотеку (например, `xstate`) для динамической инициализации машины состояний на основе JSON-конфига.
*   **Валидация:** Перед выполнением перехода проверяет:
    1.  Разрешен ли переход в текущем состоянии (согласно графу версии).
    2.  Пройдены ли валидаторы (`IValidatorProvider`).
*   **Роутинг:** При создании задачи вызывает `IAssigneeProvider`, указанный в конфиге ноды, для определения `assignee_id`.

### 3.3. Управление версиями
*   Метод `publishVersion(workflowId, config)`: Создает новую запись в `workflow_versions`, инкрементирует номер версии и обновляет `current_version_id` в шаблоне.
*   Старые версии никогда не удаляются и не изменяются.

---

## 4. Визуальный редактор (Frontend)

### 4.1. Технологический стек
*   **React Flow:** Для отрисовки графа, drag-and-drop нод и связей.
*   **XState Inspector (опционально):** Для отладки логики переходов.

### 4.2. Функционал редактора
1.  **Палитра (Sidebar):** Список доступных типов нод (Start, User Task, End, Gateway) и доступных делегатов (полученных из `/meta`).
2.  **Холст (Canvas):**
    *   Создание и удаление нод.
    *   Соединение нод стрелками (Edges).
    *   Поддержка зума и панорамирования.
3.  **Панель свойств (Properties Panel):**
    *   Открывается при клике на ноду.
    *   Позволяет задать: Название, Тип статуса, Выбор делегата (Assignee/Validator), Параметры делегата.
4.  **Валидация схемы:**
    *   Проверка наличия стартовой и конечной нод.
    *   Проверка заполнения обязательных полей у делегатов.
5.  **Сохранение:** Генерация JSON-конфига (`nodes`, `edges`, `node_configs`) и отправка на бэкенд для публикации новой версии.

---

## 5. API Интерфейс (Fastify)

### 5.1. Администрирование процессов
*   `GET /api/admin/workflows` — Список шаблонов.
*   `POST /api/admin/workflows` — Создание нового шаблона.
*   `GET /api/admin/workflows/:id/versions` — История версий.
*   `POST /api/admin/workflows/:id/publish` — Публикация новой версии схемы.
*   `GET /api/admin/builder/meta` — Получение списка зарегистрированных делегатов.

### 5.2. Работа с процессами (Runtime)
*   `POST /api/processes/:code/start` — Запуск нового экземпляра (использует `current_version_id`).
*   `GET /api/processes/:id` — Детали процесса (payload, текущий статус, версия).
*   `POST /api/processes/:id/actions/:action` — Выполнение действия (переход).
*   `GET /api/tasks/my` — Список задач текущего пользователя.
*   `GET /api/processes/:id/timeline` — История аудита.

---

## 6. План реализации

| Этап | Задачи | Срок |
|------|--------|------|
| **1. Ядро и БД** | Схема БД с версиями, Реестр плагинов, Базовый Engine на xstate | 1.5 нед. |
| **2. API и Интеграция** | Эндпоинты запуска и действий, Валидация переходов, Заглушки уведомлений | 1 нед. |
| **3. Редактор (FE)** | Интеграция React Flow, Панель свойств, Сохранение JSON-конфига | 2 нед. |
| **4. UI Пользователя** | Инбокс задач, Карточка процесса, Таймлайн, Выполнение действий | 1.5 нед. |
| **5. Тестирование** | E2E тесты версионности, Нагрузочное тестирование, Документация | 1 нед. |

---

## 7. Критерии приемки (Acceptance Criteria)

1.  **Версионность:** При изменении схемы и публикации v2, старые заявки остаются на v1 и работают корректно.
2.  **Динамика:** Админ может создать процесс с уникальными статусами (напр. `magic_step`) и назначить на него делегата из списка.
3.  **Безопасность переходов:** Невозможно выполнить действие, не описанное в графе текущей версии процесса.
4.  **Роутинг:** Задачи автоматически назначаются пользователям через `IAssigneeProvider`.
5.  **Аудит:** Все действия фиксируются в `audit_log` с указанием старого и нового статуса.

---

## 8. Риски и Митигации

*   **Риск:** Сложность отладки динамических машин состояний.
    *   *Митигация:* Внедрение подробного логгинга в Engine и визуализация текущего состояния в админке.
*   **Риск:** Ошибки в конфигурации JSON при ручном редактировании.
    *   *Митигация:* Строгая валидация JSON-схемы конфига на бэкенде перед сохранением версии.
*   **Риск:** Производительность при большом количестве версий.
    *   *Митигация:* Кэширование конфигов версий в Redis/памяти.

---

**Статус:** Готово к разработке.  
**Ответственный за архитектуру:** [Твое Имя]
