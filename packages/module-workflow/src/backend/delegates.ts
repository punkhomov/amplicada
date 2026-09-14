import type { AssigneeProvider } from '../contracts/registry.js';

export const processInitiatorProvider: AssigneeProvider = {
  async resolve({ context }) {
    const startedBy = context.startedBy;
    if (typeof startedBy !== 'string' || !startedBy) {
      throw new Error('process-initiator: в context процесса отсутствует startedBy');
    }
    return startedBy;
  },
};
