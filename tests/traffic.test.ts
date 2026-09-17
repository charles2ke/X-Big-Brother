import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregate, bytesLabel, dayKeys, demoSnapshot, filterApps, total } from '../src/traffic.ts'

test('formats bytes including zero, unit boundaries, and invalid values', () => {
  assert.equal(bytesLabel(0), '0 B')
  assert.equal(bytesLabel(1024), '1.0 KB')
  assert.equal(bytesLabel(1024 ** 3), '1.0 GB')
  assert.equal(bytesLabel(-1), 'Unavailable')
  assert.equal(bytesLabel(Number.NaN), 'Unavailable')
})

test('UTC date windows include today and cross month/year boundaries', () => {
  const keys = dayKeys(7, new Date('2026-01-02T00:01:00Z'))
  assert.equal(keys.length, 7)
  assert.equal(keys[0], '2025-12-27')
  assert.equal(keys.at(-1), '2026-01-02')
  assert.equal(dayKeys(30, new Date('2024-03-01Z')).at(-2), '2024-02-29')
})

test('totals include sent/received values already combined by the native bridge', () => {
  const days = [{ date: '2026-01-01', wifi: 12, mobile: 4 }, { date: '2026-01-02', wifi: 5, mobile: 3 }]
  assert.equal(total(days, 'all'), 24)
  assert.equal(total(days, 'wifi'), 17)
  assert.equal(total(days, 'mobile'), 7)
  assert.equal(total([], 'all'), 0)
})

test('aggregation fills empty days, ignores dates outside the window, and sums app groups once', () => {
  const app = { id: '1', name: 'Shared', packages: ['one', 'two'], permissions: [],
    days: [{ date: '2026-01-01', wifi: 12, mobile: 4 }] }
  assert.deepEqual(aggregate([app], ['2026-01-01', '2026-01-02']), [
    { date: '2026-01-01', wifi: 12, mobile: 4 },
    { date: '2026-01-02', wifi: 0, mobile: 0 },
  ])
  assert.deepEqual(aggregate([], ['2026-01-01']), [{ date: '2026-01-01', wifi: 0, mobile: 0 }])
})

test('demo is explicit, deterministic, and matches the selected period', () => {
  const now = new Date('2026-01-01Z')
  const data = demoSnapshot(30, now)
  assert.deepEqual(data, demoSnapshot(30, now))
  assert.match(data.warnings[0], /Sample data only/)
  assert.equal(data.apps[0].days.length, 30)
  assert.ok(data.apps.every(app => app.packages[0].startsWith('example.demo.')))
})

test('app search is case-insensitive, matches packages, and does not mutate source order', () => {
  const apps = demoSnapshot(7).apps.toReversed()
  const ids = apps.map(app => app.id)
  assert.equal(filterApps(apps, ' STREAMLINE ', 'all').length, 1)
  assert.equal(filterApps(apps, 'example.demo.maps', 'wifi')[0].name, 'Maps')
  assert.equal(filterApps(apps, 'no such app', 'all').length, 0)
  const sorted = filterApps(apps, '', 'mobile')
  assert.ok(total(sorted[0].days, 'mobile') >= total(sorted[1].days, 'mobile'))
  assert.deepEqual(apps.map(app => app.id), ids)
})
