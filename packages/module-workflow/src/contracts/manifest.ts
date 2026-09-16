import packageJson from '../../package.json' with { type: 'json' };

export const moduleManifest = {
  id: 'workflow',
  name: 'Workflow Module',
  version: packageJson.version,
};
