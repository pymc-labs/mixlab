export type SensitivityGroup = 'prior' | 'likelihood';
export type SensitivityChannel = {
  low: number;
  median: number;
  high: number;
  density: number[];
};
export type SensitivityPoint = {
  power: number;
  paretoK: number | null;
  weightEss: number;
  reliable: boolean;
  channels: SensitivityChannel[];
};
export type SensitivityResult =
  | {
      status: 'available';
      method: 'psis-power-scaling';
      draws: number;
      paretoThreshold: number;
      binCenters: number[][];
      scores: Record<SensitivityGroup, (number | null)[]>;
      groups: Record<SensitivityGroup, SensitivityPoint[]>;
    }
  | { status: 'unavailable'; reason: string };

/** Validate optional imported plot data before it reaches charts. Old fits remain valid. */
export function validSensitivity(
  value: unknown,
  channels: number,
  draws: number,
): value is SensitivityResult {
  if (!value || typeof value !== 'object') return false;
  const s = value as SensitivityResult;
  if (s.status === 'unavailable')
    return typeof s.reason === 'string' && s.reason.length <= 1000;
  if (
    s.status !== 'available' ||
    s.method !== 'psis-power-scaling' ||
    s.draws !== draws ||
    !Number.isFinite(s.paretoThreshold) ||
    s.paretoThreshold <= 0 ||
    s.paretoThreshold > 0.7 ||
    !Array.isArray(s.binCenters) ||
    s.binCenters.length !== channels
  )
    return false;
  const vector = (v: unknown, n: number): v is number[] =>
    Array.isArray(v) && v.length === n && v.every(Number.isFinite);
  if (
    !s.binCenters.every(
      (v) => vector(v, 48) && v.every((x, i) => !i || x > v[i - 1]),
    )
  )
    return false;
  return (['prior', 'likelihood'] as const).every((group) => {
    const scores = s.scores?.[group],
      points = s.groups?.[group];
    if (
      !Array.isArray(scores) ||
      scores.length !== channels ||
      !scores.every((v) => v === null || (Number.isFinite(v) && v >= 0)) ||
      !Array.isArray(points) ||
      points.length !== 21
    )
      return false;
    return points.every(
      (p, i) =>
        p &&
        Number.isFinite(p.power) &&
        Math.abs(p.power - Math.pow(1.25, (i - 10) / 10)) < 1e-8 &&
        (p.paretoK === null || Number.isFinite(p.paretoK)) &&
        Number.isFinite(p.weightEss) &&
        p.weightEss > 0 &&
        p.weightEss <= draws * (1 + 1e-8) &&
        typeof p.reliable === 'boolean' &&
        p.reliable ===
          (p.paretoK !== null &&
            p.paretoK < s.paretoThreshold &&
            p.weightEss >= Math.min(400, draws / 2)) &&
        Array.isArray(p.channels) &&
        p.channels.length === channels &&
        p.channels.every(
          (c) =>
            c &&
            [c.low, c.median, c.high].every(Number.isFinite) &&
            c.low <= c.median &&
            c.median <= c.high &&
            vector(c.density, 48) &&
            c.density.every((v) => v >= 0),
        ),
    );
  });
}

export function sensitivityDiagnosis(
  prior: number | null,
  likelihood: number | null,
) {
  if (prior === null || likelihood === null) return 'Sensitivity unavailable';
  if (prior >= 0.05 && likelihood >= 0.05)
    return 'Possible prior–data conflict';
  if (prior >= 0.05 && likelihood < 0.05)
    return 'Strong prior / weak likelihood';
  return 'No sensitivity flag';
}
