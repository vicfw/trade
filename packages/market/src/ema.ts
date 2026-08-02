/** EMA with SMA seed over the first `period` values. Null until seeded. */
export function ema(values: number[], period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`EMA period must be > 0, got ${period}`)
  }

  const out: Array<number | null> = Array.from(
    { length: values.length },
    () => null,
  )
  if (values.length < period) return out

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += values[i]!
  }

  let prev = sum / period
  out[period - 1] = prev

  const k = 2 / (period + 1)
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k)
    out[i] = prev
  }

  return out
}
