/** Человекочитаемый размер файла; единицы подбираются по величине, формат — по локали. */
export function formatBytes(bytes: number): string {
  const units = [
    { unit: 'byte', factor: 1 },
    { unit: 'kilobyte', factor: 1024 },
    { unit: 'megabyte', factor: 1024 ** 2 },
    { unit: 'gigabyte', factor: 1024 ** 3 },
  ] as const;

  let chosen: (typeof units)[number] = units[0];
  for (const candidate of units) {
    if (bytes >= candidate.factor) chosen = candidate;
  }

  return new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: chosen.unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(chosen.factor === 1 ? bytes : bytes / chosen.factor);
}
