import packageJson from '../../package.json' with { type: 'json' };

export const moduleManifest = {
  id: 'metrics',
  name: 'Metrics',
  version: packageJson.version,
};
