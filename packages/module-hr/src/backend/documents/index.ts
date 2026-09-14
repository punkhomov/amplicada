import { DashboardTopics, type DocumentRegistry } from '@amplicada/platform-core/contracts';

import type { HrStructureService } from '../services/hr-structure-service.js';
import { HR_STRUCTURE_SECTION } from './constants.js';
import { registerCostCenterDoc } from './cost-center.js';
import { registerDepartmentDoc } from './department.js';
import { registerJobFamilyDoc } from './job-family.js';
import { registerLegalEntityDoc } from './legal-entity.js';
import { registerPositionGradeDoc } from './position-grade.js';
import { registerPositionTemplateDoc } from './position-template.js';
import { registerRoleDoc } from './role.js';
import { registerStaffUnitDoc } from './staff-unit.js';
import { registerTagDoc } from './tag.js';
import { extendUserDoc } from './user.js';
import { registerVirtualTeamDoc } from './virtual-team.js';
import { registerWorkScheduleDoc } from './work-schedule.js';

export { registerCostCenterDoc } from './cost-center.js';
export { registerDepartmentDoc } from './department.js';
export { registerJobFamilyDoc } from './job-family.js';
export { registerLegalEntityDoc } from './legal-entity.js';
export { registerPositionGradeDoc } from './position-grade.js';
export { registerPositionTemplateDoc } from './position-template.js';
export { registerRoleDoc } from './role.js';
export { registerStaffUnitDoc } from './staff-unit.js';
export { registerTagDoc } from './tag.js';
export { extendUserDoc } from './user.js';
export { registerVirtualTeamDoc } from './virtual-team.js';
export { registerWorkScheduleDoc } from './work-schedule.js';

export function registerHrDocuments(docs: DocumentRegistry, hrStructureService: HrStructureService): void {
  docs.dashboard.registerSection(HR_STRUCTURE_SECTION, { topic: DashboardTopics.DOCUMENTS, label: 'hr:dashboard_section' });

  extendUserDoc(docs);
  registerJobFamilyDoc(docs);
  registerPositionGradeDoc(docs);
  registerPositionTemplateDoc(docs);
  registerWorkScheduleDoc(docs);
  registerTagDoc(docs);
  registerRoleDoc(docs);
  registerLegalEntityDoc(docs, hrStructureService);
  registerDepartmentDoc(docs, hrStructureService);
  registerCostCenterDoc(docs, hrStructureService);
  registerStaffUnitDoc(docs, hrStructureService);
  registerVirtualTeamDoc(docs, hrStructureService);
}
