// Single source of "now" so background jobs and demos can be time-travelled (dev only, see routes/dev.ts).
let offsetMs = 0

export function now(): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

export function nowMs(): number {
  return Date.now() + offsetMs
}

export function advanceClock(ms: number): void {
  offsetMs += ms
}

export function resetClock(): void {
  offsetMs = 0
}

export function clockOffsetMs(): number {
  return offsetMs
}
