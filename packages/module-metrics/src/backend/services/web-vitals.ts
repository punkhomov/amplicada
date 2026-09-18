export interface VitalSpec {
  key: string;
  instrument: string;
  unit: 'ms' | '1';
  boundaries: number[];
}

/** Пороги Core Web Vitals: границы гистограммы совпадают с good/poor-границами. */
export const VITAL_SPECS: Record<string, VitalSpec> = {
  lcp: { key: 'lcp', instrument: 'web_vital.lcp', unit: 'ms', boundaries: [2500, 4000] },
  inp: { key: 'inp', instrument: 'web_vital.inp', unit: 'ms', boundaries: [200, 500] },
  cls: { key: 'cls', instrument: 'web_vital.cls', unit: '1', boundaries: [0.1, 0.25] },
  fcp: { key: 'fcp', instrument: 'web_vital.fcp', unit: 'ms', boundaries: [1800, 3000] },
  ttfb: { key: 'ttfb', instrument: 'web_vital.ttfb', unit: 'ms', boundaries: [800, 1800] },
};

export function vitalSpecForEvent(name: string): VitalSpec | null {
  if (!name.startsWith('web_vital.')) return null;
  return VITAL_SPECS[name.slice('web_vital.'.length)] ?? null;
}
