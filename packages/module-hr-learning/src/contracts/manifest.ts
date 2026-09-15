import packageJson from '../../package.json' with { type: 'json' };

const { amplicada, version } = packageJson;

export const moduleManifest = { id: amplicada.id, name: amplicada.name, version };
export const backendManifest = { ...moduleManifest, dependencies: amplicada.backend.dependencies };
export const frontendManifest = { ...moduleManifest, dependencies: amplicada.frontend.dependencies };
