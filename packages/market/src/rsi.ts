/** RSI with Wilder smoothing. Null until enough bars. */
export function rsi(closes: number[], period = 14): Array<number | null> {
  if (period <= 0) {
    throw new Error(`RSI period must be > 0, got ${period}`)
  }

  const out: Array<number | null> = Array.from(
    { length: closes.length },
    () => null,
  )
  if (closes.length <= period) return out

  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!
    if (change >= 0) avgGain += change
    else avgLoss -= change
  }

  avgGain /= period
  avgLoss /= period

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }

  return out
}
