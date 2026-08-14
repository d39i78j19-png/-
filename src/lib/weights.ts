import { WEIGHT_KEYS, type Weights } from "./schema";

/**
 * weights を合計 1.0 に正規化する。仕様の「合計が異なる場合は正規化する」を担保する。
 * - 負値は 0 に丸める
 * - 合計が 0 / 非有限なら 5 軸均等（0.2 ずつ）にフォールバックする
 * - 小数第4位に丸めたうえで、丸め誤差を最大の軸に寄せて合計を厳密に 1 にする
 */
export function normalizeWeights(input: Partial<Weights> | undefined): Weights {
  const sanitized = {} as Weights;
  let sum = 0;
  for (const key of WEIGHT_KEYS) {
    const raw = Number(input?.[key]);
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    sanitized[key] = value;
    sum += value;
  }

  if (sum <= 0) {
    const even = 1 / WEIGHT_KEYS.length;
    for (const key of WEIGHT_KEYS) sanitized[key] = even;
    return sanitized;
  }

  let rounded = 0;
  for (const key of WEIGHT_KEYS) {
    sanitized[key] = Math.round((sanitized[key] / sum) * 10000) / 10000;
    rounded += sanitized[key];
  }

  // 丸め誤差を最も重い軸に吸収させ、合計を厳密に 1.0 にする
  const drift = Math.round((1 - rounded) * 10000) / 10000;
  if (drift !== 0) {
    const heaviest = WEIGHT_KEYS.reduce((a, b) =>
      sanitized[a] >= sanitized[b] ? a : b,
    );
    sanitized[heaviest] = Math.round((sanitized[heaviest] + drift) * 10000) / 10000;
  }
  return sanitized;
}

/** 合計が 1.0 から乖離しているか（正規化が実際に必要だったか）を判定する。 */
export function weightsSum(input: Partial<Weights> | undefined): number {
  let sum = 0;
  for (const key of WEIGHT_KEYS) {
    const raw = Number(input?.[key]);
    if (Number.isFinite(raw) && raw > 0) sum += raw;
  }
  return Math.round(sum * 10000) / 10000;
}
