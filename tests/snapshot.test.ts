import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSnapshot, SnapshotError } from '../src/snapshot.ts'
import { demoSnapshot } from '../src/traffic.ts'

const now = new Date('2026-01-02T03:04:05Z')
// Bridge payloads are plain JSON, so tests corrupt a JSON copy.
const payload = (days: 7 | 30 = 7) => JSON.parse(JSON.stringify(demoSnapshot(days, now)))

test('valid snapshots, including the demo, parse to fresh copies with only known fields', () => {
  for (const days of [7, 30] as const) assert.deepEqual(parseSnapshot(payload(days)), demoSnapshot(days, now))
  const raw = payload()
  raw.extra = 'ignored'
  raw.apps[0].days[0].extra = 1
  raw.apps[0].permissions[0].extra = true
  raw.warnings = ['Repeated', 'Repeated', 'Other']
  raw.unavailableNetworks = ['mobile', 'mobile']
  const parsed = parseSnapshot(raw)
  assert.equal('extra' in parsed, false)
  assert.equal('extra' in parsed.apps[0].days[0], false)
  assert.equal('extra' in parsed.apps[0].permissions[0], false)
  assert.notEqual(parsed.apps[0].days[0], raw.apps[0].days[0])
  assert.deepEqual(parsed.warnings, ['Repeated', 'Other'])
  assert.deepEqual(parsed.unavailableNetworks, ['mobile'])
})

test('payloads without the foreground/background split stay usable and mark it unavailable', () => {
  const raw = payload()
  delete raw.backgroundAvailable
  for (const app of raw.apps) {
    for (const day of app.days) {
      for (const key of ['wifiBackground', 'mobileBackground', 'wifiBackgroundSent', 'mobileBackgroundSent']) delete day[key]
    }
  }
  const parsed = parseSnapshot(raw)
  assert.equal(parsed.backgroundAvailable, false)
  assert.equal(parsed.apps[0].days[0].wifi, raw.apps[0].days[0].wifi)
  assert.ok(parsed.apps.every(app => app.days.every(day => day.wifiBackground === 0 && day.mobileBackground === 0
    && day.wifiBackgroundSent === 0 && day.mobileBackgroundSent === 0)))
})

test('malformed snapshots fail with a SnapshotError that names the problem', () => {
  // Each case corrupts a valid payload and expects a message matching the pattern.
  const cases: [RegExp, (raw: ReturnType<typeof payload>) => unknown][] = [
    [/snapshot must be an object/, () => null],
    [/snapshot must be an object/, () => []],
    [/accessGranted must be a boolean/, raw => ({ ...raw, accessGranted: 'yes' })],
    [/generatedAt must be a date/, raw => ({ ...raw, generatedAt: 'yesterday' })],
    [/apps must be an array/, raw => ({ ...raw, apps: {} })],
    [/backgroundAvailable must be a boolean/, raw => ({ ...raw, backgroundAvailable: 'true' })],
    [/warnings\[0\] must be a string/, raw => ({ ...raw, warnings: [1] })],
    [/unavailableNetworks\[0\] must be wifi or mobile/, raw => ({ ...raw, unavailableNetworks: ['bluetooth'] })],
    [/apps\[0\]\.id must not be empty/, raw => { raw.apps[0].id = ''; return raw }],
    [/apps\[1\]\.id repeats "demo-0"/, raw => { raw.apps[1].id = 'demo-0'; return raw }],
    [/apps\[0\]\.packages\[0\] must be a string/, raw => { raw.apps[0].packages = [null]; return raw }],
    [/apps\[0\]\.permissions\[1\]\.id repeats/, raw => { raw.apps[0].permissions[1].id = raw.apps[0].permissions[0].id; return raw }],
    [/apps\[0\]\.permissions\[0\]\.granted must be a boolean/, raw => { raw.apps[0].permissions[0].granted = 1; return raw }],
    [/apps\[0\]\.days\[0\]\.date must be YYYY-MM-DD/, raw => { raw.apps[0].days[0].date = '2026-1-2'; return raw }],
    [/apps\[0\]\.days\[1\]\.date repeats/, raw => { raw.apps[0].days[1].date = raw.apps[0].days[0].date; return raw }],
    [/apps\[0\]\.days\[0\]\.wifi must be a non-negative number/, raw => { raw.apps[0].days[0].wifi = -1; return raw }],
    [/apps\[0\]\.days\[0\]\.mobile must be a non-negative number/, raw => { raw.apps[0].days[0].mobile = Number.NaN; return raw }],
    [/apps\[0\]\.days\[0\]\.wifiSent must be a non-negative number/, raw => { raw.apps[0].days[0].wifiSent = '5'; return raw }],
    // With the split reported, every day must carry it.
    [/apps\[0\]\.days\[0\]\.wifiBackground must be a non-negative number/, raw => { delete raw.apps[0].days[0].wifiBackground; return raw }],
    [/apps\[0\]\.days\[0\] has inconsistent wifi counters/, raw => { raw.apps[0].days[0].wifiSent = raw.apps[0].days[0].wifi + 1; return raw }],
    [/apps\[0\]\.days\[0\] has inconsistent mobile counters/, raw => { raw.apps[0].days[0].mobileBackground = raw.apps[0].days[0].mobile + 1; return raw }],
    // Background received (80 − 10) cannot exceed all received (100 − 50).
    [/apps\[0\]\.days\[0\] has inconsistent wifi counters/, raw => {
      Object.assign(raw.apps[0].days[0], { wifi: 100, wifiSent: 50, wifiBackground: 80, wifiBackgroundSent: 10 })
      return raw
    }],
  ]
  for (const [pattern, corrupt] of cases) {
    assert.throws(() => parseSnapshot(corrupt(payload())), error => error instanceof SnapshotError && pattern.test(error.message),
      `expected ${pattern}`)
  }
})
