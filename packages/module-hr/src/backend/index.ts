export { registerHrDocuments } from './documents/index.js';

export {
  hrCostCenterNode,
  hrCostCenterVersion,
  hrDepartmentNode,
  hrDepartmentVersion,
  hrEmployeeAppointment,
  hrJobFamily,
  hrLegalEntityNode,
  hrLegalEntityVersion,
  hrPositionGrade,
  hrPositionTemplate,
  hrRole,
  hrStaffUnitNode,
  hrStaffUnitVersion,
  hrTag,
  hrTeamMember,
  hrUserProfile,
  hrVirtualTeamNode,
  hrVirtualTeamVersion,
  hrWorkSchedule,
} from './schemas/index.js';
export {
  InvalidEffectiveDateError,
  NodeHasActiveAppointmentsError,
  ParentCycleDetectedError,
  VersionOverlapError,
} from './services/errors.js';
export type {
  AuditInfo,
  CreateCostCenterInput,
  CreateDepartmentInput,
  CreateLegalEntityInput,
  CreateStaffUnitInput,
  CreateVirtualTeamInput,
  UpdateCostCenterAttributes,
  UpdateDepartmentAttributes,
  UpdateLegalEntityAttributes,
  UpdateStaffUnitAttributes,
  UpdateVirtualTeamAttributes,
} from './services/hr-structure-service.js';
export { HrStructureService } from './services/hr-structure-service.js';
export { hrModule as module } from './setup.js';
