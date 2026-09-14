import type { BackendDbService, BackendDocumentRuntime } from '@amplicada/platform-core/contracts/backend';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  type HrCostCenterVersion,
  type HrDepartmentVersion,
  type HrEmployeeAppointment,
  type HrLegalEntityVersion,
  type HrStaffUnitVersion,
  type HrVirtualTeamVersion,
  hrCostCenterNode,
  hrCostCenterVersion,
  hrDepartmentNode,
  hrDepartmentVersion,
  hrEmployeeAppointment,
  hrLegalEntityNode,
  hrLegalEntityVersion,
  hrStaffUnitNode,
  hrStaffUnitVersion,
  hrVirtualTeamNode,
  hrVirtualTeamVersion,
} from '../schemas/index.js';
import { InvalidEffectiveDateError, NodeHasActiveAppointmentsError, ParentCycleDetectedError } from './errors.js';
import { dayBefore, writeVersion } from './versioning.js';

/**
 * `null` — коррекция записи (правим текущую версию на месте), дата — новый факт с неё.
 * См. `writeVersion` и ref/plans/2026-08-05-document-model/05-hr-versioning.md.
 */
export type EffectiveDate = string | null;

export interface AuditInfo {
  performedByUserId: string;
  sourceDocumentId?: string | null;
  comment?: string | null;
  /** Разрешает effectiveDate в прошлом (импорт/ручная корректировка администратором). */
  isSystemCorrection?: boolean;
}

interface ServiceOpts {
  db?: BackendDbService;
}

export interface CreateDepartmentInput {
  code: string;
  name: string;
  shortName?: string | null;
  type?: string | null;
  parentNodeId?: string | null;
  headUserId?: string | null;
  orderIndex?: number;
  validFrom: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateDepartmentAttributes {
  name?: string;
  shortName?: string | null;
  headUserId?: string | null;
  type?: string | null;
  orderIndex?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateCostCenterInput {
  code: string;
  name: string;
  parentNodeId?: string | null;
  legalEntityNodeId?: string | null;
  validFrom: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCostCenterAttributes {
  name?: string;
  legalEntityNodeId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateLegalEntityInput {
  code: string;
  shortName: string;
  fullName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  validFrom: string;
}

export interface UpdateLegalEntityAttributes {
  shortName?: string;
  fullName?: string | null;
  inn?: string | null;
  kpp?: string | null;
}

export interface CreateStaffUnitInput {
  code: string;
  departmentNodeId: string;
  templateId: string;
  gradeId?: string | null;
  legalEntityNodeId: string;
  costCenterNodeId?: string | null;
  quantity?: string;
  minSalary?: string | null;
  maxSalary?: string | null;
  validFrom: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateStaffUnitAttributes {
  gradeId?: string | null;
  legalEntityNodeId?: string;
  costCenterNodeId?: string | null;
  quantity?: string;
  minSalary?: string | null;
  maxSalary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateVirtualTeamInput {
  code: string;
  name: string;
  type?: string | null;
  leadUserId?: string | null;
  departmentNodeId?: string | null;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  validFrom: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateVirtualTeamAttributes {
  name?: string;
  type?: string | null;
  leadUserId?: string | null;
  departmentNodeId?: string | null;
  metadata?: Record<string, unknown>;
}

interface HrStructureServiceDeps {
  db: BackendDbService;
  /** id узла рождается в core.document_index — базовые таблицы hr ссылаются на него внешним ключом. */
  documentRuntime: BackendDocumentRuntime;
}

/** Тип документа для каждого из пяти узловых типов — под аллокацию id в document_index. */
const NODE_DOC_TYPES = {
  department: 'department',
  costCenter: 'cost-center',
  legalEntity: 'legal-entity',
  staffUnit: 'staff-unit',
  virtualTeam: 'virtual-team',
} as const;

/**
 * Единственный писатель в hr_*_node/hr_*_version. Инкапсулирует закрытие/создание версий,
 * materialized path (department), проверки на активные назначения и циклы в иерархии —
 * взамен разрозненной inline-логики, ранее продублированной в save() каждого документа.
 */
export class HrStructureService {
  constructor(private deps: HrStructureServiceDeps) {}

  private inTransaction<T>(external: BackendDbService | undefined, fn: (db: BackendDbService) => Promise<T>): Promise<T> {
    return external ? fn(external) : this.deps.db.transaction(fn);
  }

  /** Для коррекции (`effectiveDate === null`) проверять нечего: она не заявляет дату вступления в силу. */
  private assertValidEffectiveDate(effectiveDate: EffectiveDate, audit: AuditInfo): void {
    if (effectiveDate === null) return;
    const today = new Date().toISOString().slice(0, 10);
    if (effectiveDate < today && !audit.isSystemCorrection) {
      throw new InvalidEffectiveDateError();
    }
  }

  // ---- Department ----

  // Хелперов «прочитать текущую версию» здесь больше нет: их единственными потребителями были
  // updateXAttributes/reparentX, а теперь текущую версию читает сам writeVersion — он же и решает,
  // коррекция это или новый интервал.

  /** Публичный — переиспользуется document-слоем для bootstrap первой версии (узел уже создан generic create()). */
  async buildDepartmentPath(db: BackendDbService, parentNodeId: string | null, code: string): Promise<string> {
    if (!parentNodeId) return code;
    const [parentVersion] = await db
      .select({ path: hrDepartmentVersion.path })
      .from(hrDepartmentVersion)
      .where(and(eq(hrDepartmentVersion.nodeId, parentNodeId), isNull(hrDepartmentVersion.validTo)))
      .limit(1);
    return `${parentVersion?.path ?? parentNodeId}/${code}`;
  }

  private async assertNoDepartmentParentCycle(db: BackendDbService, nodeId: string, newParentNodeId: string): Promise<void> {
    let current: string | null = newParentNodeId;
    while (current) {
      if (current === nodeId) throw new ParentCycleDetectedError();
      const [row] = await db
        .select({ parentNodeId: hrDepartmentVersion.parentNodeId })
        .from(hrDepartmentVersion)
        .where(and(eq(hrDepartmentVersion.nodeId, current), isNull(hrDepartmentVersion.validTo)))
        .limit(1);
      current = row?.parentNodeId ?? null;
    }
  }

  /** Обновляет path у всех прямых и транзитивных потомков parentNodeId (уже переподчинённого/созданного с новым path). */
  private async cascadeDepartmentPath(
    db: BackendDbService,
    parentNodeId: string,
    parentPath: string,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
  ): Promise<void> {
    const children = await db
      .select()
      .from(hrDepartmentVersion)
      .where(and(eq(hrDepartmentVersion.parentNodeId, parentNodeId), isNull(hrDepartmentVersion.validTo)));

    for (const child of children) {
      const [childNode] = await db
        .select({ code: hrDepartmentNode.code })
        .from(hrDepartmentNode)
        .where(eq(hrDepartmentNode.id, child.nodeId))
        .limit(1);
      const childPath = `${parentPath}/${childNode?.code ?? child.nodeId}`;

      await writeVersion(db, hrDepartmentVersion, {
        nodeId: child.nodeId,
        effectiveDate,
        values: { path: childPath },
        audit: { ...audit, comment: 'Каскадное обновление path при переподчинении родителя' },
      });

      await this.cascadeDepartmentPath(db, child.nodeId, childPath, effectiveDate, audit);
    }
  }

  async createDepartment(input: CreateDepartmentInput, audit: AuditInfo, opts: ServiceOpts = {}): Promise<HrDepartmentVersion> {
    return this.inTransaction(opts.db, async db => {
      const nodeId = await this.deps.documentRuntime.allocateDocumentId(NODE_DOC_TYPES.department, db);
      const [node] = await db.insert(hrDepartmentNode).values({ id: nodeId, code: input.code }).returning();
      const path = await this.buildDepartmentPath(db, input.parentNodeId ?? null, input.code);
      const [version] = await db
        .insert(hrDepartmentVersion)
        .values({
          nodeId: node.id,
          parentNodeId: input.parentNodeId ?? null,
          path,
          name: input.name,
          shortName: input.shortName ?? null,
          type: input.type ?? null,
          headUserId: input.headUserId ?? null,
          orderIndex: input.orderIndex ?? 0,
          validFrom: input.validFrom,
          metadata: input.metadata ?? {},
          createdByUserId: audit.performedByUserId,
          sourceDocumentId: audit.sourceDocumentId ?? null,
          comment: audit.comment ?? null,
        })
        .returning();
      return version;
    });
  }

  async updateDepartmentAttributes(
    nodeId: string,
    changes: UpdateDepartmentAttributes,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrDepartmentVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, db =>
      writeVersion<HrDepartmentVersion>(db, hrDepartmentVersion, { nodeId, effectiveDate, values: { ...changes }, audit }),
    );
  }

  async reparentDepartment(
    nodeId: string,
    newParentNodeId: string | null,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrDepartmentVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, async db => {
      if (newParentNodeId) await this.assertNoDepartmentParentCycle(db, nodeId, newParentNodeId);

      const [node] = await db
        .select({ code: hrDepartmentNode.code })
        .from(hrDepartmentNode)
        .where(eq(hrDepartmentNode.id, nodeId))
        .limit(1);
      const newPath = await this.buildDepartmentPath(db, newParentNodeId, node?.code ?? nodeId);

      const updatedRoot = await writeVersion<HrDepartmentVersion>(db, hrDepartmentVersion, {
        nodeId,
        effectiveDate,
        values: { parentNodeId: newParentNodeId, path: newPath },
        audit: { ...audit, comment: audit.comment ?? 'Переподчинение' },
      });

      await this.cascadeDepartmentPath(db, nodeId, newPath, effectiveDate, audit);
      return updatedRoot;
    });
  }

  async deactivateDepartment(nodeId: string, effectiveDate: string, audit: AuditInfo, opts: ServiceOpts = {}): Promise<void> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    await this.inTransaction(opts.db, async db => {
      const staffUnits = await db
        .select({ id: hrStaffUnitNode.id })
        .from(hrStaffUnitNode)
        .where(eq(hrStaffUnitNode.departmentNodeId, nodeId));
      if (staffUnits.length) {
        const [active] = await db
          .select({ id: hrEmployeeAppointment.id })
          .from(hrEmployeeAppointment)
          .where(
            and(
              inArray(
                hrEmployeeAppointment.staffUnitNodeId,
                staffUnits.map(s => s.id),
              ),
              isNull(hrEmployeeAppointment.endDate),
            ),
          )
          .limit(1);
        if (active) throw new NodeHasActiveAppointmentsError();
      }
      await db
        .update(hrDepartmentVersion)
        .set({ validTo: effectiveDate })
        .where(and(eq(hrDepartmentVersion.nodeId, nodeId), isNull(hrDepartmentVersion.validTo)));
    });
  }

  // ---- Cost Center ----

  private async assertNoCostCenterParentCycle(db: BackendDbService, nodeId: string, newParentNodeId: string): Promise<void> {
    let current: string | null = newParentNodeId;
    while (current) {
      if (current === nodeId) throw new ParentCycleDetectedError();
      const [row] = await db
        .select({ parentNodeId: hrCostCenterVersion.parentNodeId })
        .from(hrCostCenterVersion)
        .where(and(eq(hrCostCenterVersion.nodeId, current), isNull(hrCostCenterVersion.validTo)))
        .limit(1);
      current = row?.parentNodeId ?? null;
    }
  }

  async createCostCenter(input: CreateCostCenterInput, audit: AuditInfo, opts: ServiceOpts = {}): Promise<HrCostCenterVersion> {
    return this.inTransaction(opts.db, async db => {
      const nodeId = await this.deps.documentRuntime.allocateDocumentId(NODE_DOC_TYPES.costCenter, db);
      const [node] = await db.insert(hrCostCenterNode).values({ id: nodeId, code: input.code }).returning();
      const [version] = await db
        .insert(hrCostCenterVersion)
        .values({
          nodeId: node.id,
          parentNodeId: input.parentNodeId ?? null,
          name: input.name,
          legalEntityNodeId: input.legalEntityNodeId ?? null,
          validFrom: input.validFrom,
          metadata: input.metadata ?? {},
          createdByUserId: audit.performedByUserId,
          sourceDocumentId: audit.sourceDocumentId ?? null,
          comment: audit.comment ?? null,
        })
        .returning();
      return version;
    });
  }

  async updateCostCenterAttributes(
    nodeId: string,
    changes: UpdateCostCenterAttributes,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrCostCenterVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, db =>
      writeVersion<HrCostCenterVersion>(db, hrCostCenterVersion, { nodeId, effectiveDate, values: { ...changes }, audit }),
    );
  }

  async reparentCostCenter(
    nodeId: string,
    newParentNodeId: string | null,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrCostCenterVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, async db => {
      if (newParentNodeId) await this.assertNoCostCenterParentCycle(db, nodeId, newParentNodeId);
      return writeVersion<HrCostCenterVersion>(db, hrCostCenterVersion, {
        nodeId,
        effectiveDate,
        values: { parentNodeId: newParentNodeId },
        audit: { ...audit, comment: audit.comment ?? 'Переподчинение' },
      });
    });
  }

  async deactivateCostCenter(nodeId: string, effectiveDate: string, audit: AuditInfo, opts: ServiceOpts = {}): Promise<void> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    await this.inTransaction(opts.db, async db => {
      const [active] = await db
        .select({ id: hrStaffUnitVersion.id })
        .from(hrStaffUnitVersion)
        .where(and(eq(hrStaffUnitVersion.costCenterNodeId, nodeId), isNull(hrStaffUnitVersion.validTo)))
        .limit(1);
      if (active) throw new NodeHasActiveAppointmentsError('Невозможно закрыть ЦФО: на него ссылаются активные штатные единицы.');
      await db
        .update(hrCostCenterVersion)
        .set({ validTo: effectiveDate, isActive: false })
        .where(and(eq(hrCostCenterVersion.nodeId, nodeId), isNull(hrCostCenterVersion.validTo)));
    });
  }

  // ---- Legal Entity ----

  async createLegalEntity(input: CreateLegalEntityInput, audit: AuditInfo, opts: ServiceOpts = {}): Promise<HrLegalEntityVersion> {
    return this.inTransaction(opts.db, async db => {
      const nodeId = await this.deps.documentRuntime.allocateDocumentId(NODE_DOC_TYPES.legalEntity, db);
      const [node] = await db.insert(hrLegalEntityNode).values({ id: nodeId, code: input.code }).returning();
      const [version] = await db
        .insert(hrLegalEntityVersion)
        .values({
          nodeId: node.id,
          shortName: input.shortName,
          fullName: input.fullName ?? '',
          inn: input.inn ?? null,
          kpp: input.kpp ?? null,
          validFrom: input.validFrom,
          createdByUserId: audit.performedByUserId,
          sourceDocumentId: audit.sourceDocumentId ?? null,
          comment: audit.comment ?? null,
        })
        .returning();
      return version;
    });
  }

  async updateLegalEntityAttributes(
    nodeId: string,
    changes: UpdateLegalEntityAttributes,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrLegalEntityVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, db =>
      writeVersion<HrLegalEntityVersion>(db, hrLegalEntityVersion, {
        nodeId,
        effectiveDate,
        // fullName NOT NULL: явный null от карточки означает «пусто», а не «не трогать».
        values: { ...changes, ...(changes.fullName !== undefined ? { fullName: changes.fullName ?? '' } : {}) },
        audit,
      }),
    );
  }

  async deactivateLegalEntity(nodeId: string, effectiveDate: string, audit: AuditInfo, opts: ServiceOpts = {}): Promise<void> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    await this.inTransaction(opts.db, async db => {
      const [active] = await db
        .select({ id: hrStaffUnitVersion.id })
        .from(hrStaffUnitVersion)
        .where(and(eq(hrStaffUnitVersion.legalEntityNodeId, nodeId), isNull(hrStaffUnitVersion.validTo)))
        .limit(1);
      if (active) throw new NodeHasActiveAppointmentsError('Невозможно закрыть юрлицо: на него ссылаются активные штатные единицы.');
      await db
        .update(hrLegalEntityVersion)
        .set({ validTo: effectiveDate })
        .where(and(eq(hrLegalEntityVersion.nodeId, nodeId), isNull(hrLegalEntityVersion.validTo)));
    });
  }

  // ---- Staff Unit ----

  async createStaffUnit(input: CreateStaffUnitInput, audit: AuditInfo, opts: ServiceOpts = {}): Promise<HrStaffUnitVersion> {
    return this.inTransaction(opts.db, async db => {
      const nodeId = await this.deps.documentRuntime.allocateDocumentId(NODE_DOC_TYPES.staffUnit, db);
      const [node] = await db
        .insert(hrStaffUnitNode)
        .values({ id: nodeId, code: input.code, departmentNodeId: input.departmentNodeId, templateId: input.templateId })
        .returning();
      const [version] = await db
        .insert(hrStaffUnitVersion)
        .values({
          nodeId: node.id,
          gradeId: input.gradeId ?? null,
          legalEntityNodeId: input.legalEntityNodeId,
          costCenterNodeId: input.costCenterNodeId ?? null,
          quantity: input.quantity ?? '1',
          minSalary: input.minSalary ?? null,
          maxSalary: input.maxSalary ?? null,
          validFrom: input.validFrom,
          metadata: input.metadata ?? {},
          createdByUserId: audit.performedByUserId,
          sourceDocumentId: audit.sourceDocumentId ?? null,
          comment: audit.comment ?? null,
        })
        .returning();
      return version;
    });
  }

  async updateStaffUnitAttributes(
    nodeId: string,
    changes: UpdateStaffUnitAttributes,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrStaffUnitVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, db =>
      writeVersion<HrStaffUnitVersion>(db, hrStaffUnitVersion, { nodeId, effectiveDate, values: { ...changes }, audit }),
    );
  }

  async deactivateStaffUnit(nodeId: string, effectiveDate: string, audit: AuditInfo, opts: ServiceOpts = {}): Promise<void> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    await this.inTransaction(opts.db, async db => {
      const [active] = await db
        .select({ id: hrEmployeeAppointment.id })
        .from(hrEmployeeAppointment)
        .where(and(eq(hrEmployeeAppointment.staffUnitNodeId, nodeId), isNull(hrEmployeeAppointment.endDate)))
        .limit(1);
      if (active) throw new NodeHasActiveAppointmentsError();
      await db
        .update(hrStaffUnitVersion)
        .set({ validTo: effectiveDate, isActive: false })
        .where(and(eq(hrStaffUnitVersion.nodeId, nodeId), isNull(hrStaffUnitVersion.validTo)));
    });
  }

  // ---- Virtual Team ----

  async createVirtualTeam(input: CreateVirtualTeamInput, audit: AuditInfo, opts: ServiceOpts = {}): Promise<HrVirtualTeamVersion> {
    return this.inTransaction(opts.db, async db => {
      const nodeId = await this.deps.documentRuntime.allocateDocumentId(NODE_DOC_TYPES.virtualTeam, db);
      const [node] = await db
        .insert(hrVirtualTeamNode)
        .values({
          id: nodeId,
          code: input.code,
          projectStartDate: input.projectStartDate ?? null,
          projectEndDate: input.projectEndDate ?? null,
        })
        .returning();
      const [version] = await db
        .insert(hrVirtualTeamVersion)
        .values({
          nodeId: node.id,
          name: input.name,
          type: input.type ?? null,
          leadUserId: input.leadUserId ?? null,
          departmentNodeId: input.departmentNodeId ?? null,
          validFrom: input.validFrom,
          metadata: input.metadata ?? {},
          createdByUserId: audit.performedByUserId,
          sourceDocumentId: audit.sourceDocumentId ?? null,
          comment: audit.comment ?? null,
        })
        .returning();
      return version;
    });
  }

  async updateVirtualTeamAttributes(
    nodeId: string,
    changes: UpdateVirtualTeamAttributes,
    effectiveDate: EffectiveDate,
    audit: AuditInfo,
    opts: ServiceOpts = {},
  ): Promise<HrVirtualTeamVersion> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, db =>
      writeVersion<HrVirtualTeamVersion>(db, hrVirtualTeamVersion, { nodeId, effectiveDate, values: { ...changes }, audit }),
    );
  }

  /** projectStartDate/projectEndDate живут на node (бизнес-факт о команде), не версионируются. */
  async updateVirtualTeamProjectDates(
    nodeId: string,
    changes: { projectStartDate?: string | null; projectEndDate?: string | null },
    opts: ServiceOpts = {},
  ): Promise<void> {
    await this.inTransaction(opts.db, async db => {
      await db
        .update(hrVirtualTeamNode)
        .set({
          ...(changes.projectStartDate !== undefined ? { projectStartDate: changes.projectStartDate } : {}),
          ...(changes.projectEndDate !== undefined ? { projectEndDate: changes.projectEndDate } : {}),
        })
        .where(eq(hrVirtualTeamNode.id, nodeId));
    });
  }

  async deactivateVirtualTeam(nodeId: string, effectiveDate: string, audit: AuditInfo, opts: ServiceOpts = {}): Promise<void> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    await this.inTransaction(opts.db, async db => {
      await db
        .update(hrVirtualTeamVersion)
        .set({ validTo: effectiveDate, isActive: false })
        .where(and(eq(hrVirtualTeamVersion.nodeId, nodeId), isNull(hrVirtualTeamVersion.validTo)));
    });
  }

  // ---- Employee transfer (Level 3, без версий) ----

  async transferEmployee(
    userId: string,
    newStaffUnitNodeId: string,
    effectiveDate: string,
    audit: AuditInfo,
    extra: { employmentType?: string; workScheduleId?: string | null; isPrimary?: boolean } = {},
    opts: ServiceOpts = {},
  ): Promise<HrEmployeeAppointment> {
    this.assertValidEffectiveDate(effectiveDate, audit);
    return this.inTransaction(opts.db, async db => {
      await db
        .update(hrEmployeeAppointment)
        .set({ endDate: dayBefore(effectiveDate), terminationReason: 'transfer' })
        .where(and(eq(hrEmployeeAppointment.userId, userId), isNull(hrEmployeeAppointment.endDate)));

      const [appointment] = await db
        .insert(hrEmployeeAppointment)
        .values({
          userId,
          staffUnitNodeId: newStaffUnitNodeId,
          isPrimary: extra.isPrimary ?? true,
          employmentType: extra.employmentType ?? 'full-time',
          startDate: effectiveDate,
          workScheduleId: extra.workScheduleId ?? null,
          metadata: {},
        })
        .returning();
      return appointment;
    });
  }
}
