import packageJson from '../../package.json' with { type: 'json' };

export const moduleManifest = {
  id: 'admin',
  name: 'Admin Panel',
  version: packageJson.version,
};
