export type ProcessRole = 'web' | 'worker' | 'all';

function readRole(): ProcessRole {
  const value = process.env.ROLE;
  if (value === 'web' || value === 'worker' || value === 'all') return value;
  return 'all';
}

export function getRole(): ProcessRole {
  return readRole();
}

export function isWebRole(): boolean {
  const role = readRole();
  return role === 'web' || role === 'all';
}

export function isWorkerRole(): boolean {
  const role = readRole();
  return role === 'worker' || role === 'all';
}
