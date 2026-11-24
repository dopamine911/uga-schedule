import { describe, expect, it } from "vitest"
import { foldLine } from "../routes/calendar.ts"

// RFC 5545 §3.1: content lines are at most 75 octets; longer ones continue on lines starting with one space.
const octets = (s: string) => new TextEncoder().encode(s).length
const unfold = (folded: string) => folded.replace(/\r\n /g, "")
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe("ICS line folding (US-009 ICS)", () => {
  it("leaves a line of exactly 75 octets alone", () => {
    const line = `DESCRIPTION:${"x".repeat(75 - "DESCRIPTION:".length)}`
    expect(foldLine(line)).toBe(line)
  })

  it.each([
    ["ASCII", `DESCRIPTION:${"Bring the shot list and SD cards. ".repeat(8)}`],
    ["two-byte characters", `SUMMARY:${"Café crème — résumé ".repeat(10)}`],
    ["four-byte characters", `DESCRIPTION:${"🎬🎤🎥".repeat(30)}`],
    [
      "a character straddling octet 75",
      `SUMMARY:${"a".repeat(66)}é${"b".repeat(80)}`,
    ],
  ])(
    "folds a long line with %s without losing or splitting a character",
    (_, line) => {
      const folded = foldLine(line)
      const physical = folded.split("\r\n")

      expect(physical.length).toBeGreaterThan(1)
      expect(octets(physical[0]!)).toBeLessThanOrEqual(75)
      for (const p of physical.slice(1)) {
        expect(p.startsWith(" ")).toBe(true)
        expect(octets(p)).toBeLessThanOrEqual(75)
      }
      for (const p of physical) expect(p).not.toMatch(LONE_SURROGATE)
      expect(unfold(folded)).toBe(line)
    }
  )
})
