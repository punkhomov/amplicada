import packageJson from '../../package.json' with { type: 'json' };

export const moduleManifest = {
  id: 'notification-email',
  name: 'Notification Email Module',
  version: packageJson.version,
};
