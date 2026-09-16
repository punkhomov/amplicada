#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { discoverApplication, planApplication, writeApplicationPlan } from './application.js';

try {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      target: { type: 'string' },
      app: { type: 'string' },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'amplicada-modules [--target backend|frontend] [--app directory] [--config file] [--check]\nDefaults: discover modules from dependencies in the current directory; generate both sides. No config or build framework required.',
    );
  } else {
    if (values.target !== undefined && values.target !== 'backend' && values.target !== 'frontend')
      throw new Error('--target must be backend or frontend');
    const appDirectory = resolve(values.app ?? '.');
    const config = values.config ? resolve(values.config) : undefined;
    const plan = config ? await planApplication(config) : await discoverApplication(appDirectory, values.target);
    if (config && values.target) {
      const expected = join(appDirectory, `src/generated/${values.target}-modules.ts`);
      if (!plan.files.some(file => file.side === values.target && file.path === expected)) {
        throw new Error(`Configuration ${plan.id} does not target ${appDirectory} as ${values.target}`);
      }
    }
    if (!values.check) await writeApplicationPlan(plan, values.target);
    console.log(
      `${values.check ? 'Validated' : 'Generated'} ${plan.id}: backend [${plan.order.backend.join(', ')}], frontend [${plan.order.frontend.join(', ')}]`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
