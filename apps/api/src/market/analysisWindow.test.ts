import { describe, expect, test } from "bun:test"
import {
  clampToAnalysisWindow,
  isWithinAnalysisWindow,
  nextAnalysisWindowOpen,
  zonedTimeToUtc,
  type AnalysisWindowOptions,
} from "./analysisWindow"

const TEHRAN: AnalysisWindowOptions = {
  timeZone: "Asia/Tehran",
  start: { hour: 17, minute: 0 },
  end: { hour: 1, minute: 0 },
}

/** Wall-clock in Asia/Tehran → UTC ms. */
function tehran(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return zonedTimeToUtc(year, month, day, hour, minute, "Asia/Tehran")
}

describe("analysisWindow (Asia/Tehran 17:00–01:00)", () => {
  test("isWithin: evening and late night inside, daytime outside", () => {
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 16, 59), TEHRAN)).toBe(
      false,
    )
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 17, 0), TEHRAN)).toBe(
      true,
    )
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 23, 30), TEHRAN)).toBe(
      true,
    )
    expect(isWithinAnalysisWindow(tehran(2024, 6, 11, 0, 59), TEHRAN)).toBe(
      true,
    )
    expect(isWithinAnalysisWindow(tehran(2024, 6, 11, 1, 0), TEHRAN)).toBe(
      false,
    )
    expect(isWithinAnalysisWindow(tehran(2024, 6, 11, 12, 0), TEHRAN)).toBe(
      false,
    )
  })

  test("nextOpen: 16:59 → same-day 17:00; 01:00 → same-day 17:00", () => {
    expect(nextAnalysisWindowOpen(tehran(2024, 6, 10, 16, 59), TEHRAN)).toBe(
      tehran(2024, 6, 10, 17, 0),
    )
    expect(nextAnalysisWindowOpen(tehran(2024, 6, 11, 1, 0), TEHRAN)).toBe(
      tehran(2024, 6, 11, 17, 0),
    )
    expect(nextAnalysisWindowOpen(tehran(2024, 6, 11, 10, 0), TEHRAN)).toBe(
      tehran(2024, 6, 11, 17, 0),
    )
  })

  test("clamp: keeps in-window times; bumps 00:30+45m past 01:00 to next 17:00", () => {
    const inside = tehran(2024, 6, 10, 20, 0)
    expect(clampToAnalysisWindow(inside, TEHRAN)).toBe(inside)

    // 00:30 + 45m = 01:15 → outside → next 17:00 same calendar day
    const proposed = tehran(2024, 6, 11, 0, 30) + 45 * 60_000
    expect(clampToAnalysisWindow(proposed, TEHRAN)).toBe(
      tehran(2024, 6, 11, 17, 0),
    )
  })

  test("same-day window 09:00–17:00", () => {
    const day: AnalysisWindowOptions = {
      timeZone: "Asia/Tehran",
      start: { hour: 9, minute: 0 },
      end: { hour: 17, minute: 0 },
    }
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 8, 59), day)).toBe(false)
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 9, 0), day)).toBe(true)
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 16, 59), day)).toBe(true)
    expect(isWithinAnalysisWindow(tehran(2024, 6, 10, 17, 0), day)).toBe(false)
    expect(nextAnalysisWindowOpen(tehran(2024, 6, 10, 18, 0), day)).toBe(
      tehran(2024, 6, 11, 9, 0),
    )
  })
})
