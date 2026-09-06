/** Validate optional interactive data without changing support for older projects. */
export function validDiagnosticPlots(
  value: unknown,
  chains: number,
  draws: number,
): boolean {
  const vector = (v: unknown, size?: number): v is number[] =>
    Array.isArray(v) &&
    (size === undefined || v.length === size) &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n));
  const series = (v: unknown, nullable = false) => {
    if (!v || typeof v !== 'object') return false;
    const p = v as { x: unknown; y: unknown };
    return (
      vector(p.x) &&
      p.x.length > 0 &&
      p.x.every(
        (x, i) =>
          x >= 0 && x <= 1 && (i === 0 || x >= (p.x as number[])[i - 1]),
      ) &&
      Array.isArray(p.y) &&
      p.y.length === p.x.length &&
      p.y.every(
        (y) =>
          (nullable && y === null) ||
          (typeof y === 'number' && Number.isFinite(y)),
      )
    );
  };
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 500) return false;
  return value.every((p) => {
    if (
      !p ||
      typeof p.name !== 'string' ||
      !Array.isArray(p.chains) ||
      p.chains.length !== chains ||
      !p.chains.every((c: unknown) => vector(c, draws)) ||
      !Array.isArray(p.divergences) ||
      p.divergences.length !== chains ||
      !p.divergences.every(
        (c: unknown) =>
          vector(c) &&
          c.every((n) => Number.isInteger(n) && n >= 0 && n < draws),
      )
    )
      return false;
    if (
      p.rank !== undefined &&
      (!Array.isArray(p.rank) ||
        p.rank.length !== chains ||
        !p.rank.every((r: unknown) => series(r)))
    )
      return false;
    if (p.ess !== undefined && !series(p.ess, true)) return false;
    if (p.envelope !== undefined) {
      const b = p.envelope;
      if (
        !b ||
        !vector(b.x) ||
        !series({ x: b.x, y: b.low }) ||
        !vector(b.high, b.x.length) ||
        !b.low.every((n: number, i: number) => n <= b.high[i])
      )
        return false;
    }
    return ['rankError', 'essError'].every(
      (k) => p[k] === undefined || typeof p[k] === 'string',
    );
  });
}
