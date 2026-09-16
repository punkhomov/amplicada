import packageJson from '../../package.json' with { type: 'json' };

export const moduleManifest = {
  id: 'auth-password',
  name: 'Password Authentication',
  version: packageJson.version,
};
