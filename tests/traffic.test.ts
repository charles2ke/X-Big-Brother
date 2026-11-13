import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregate, bytesFor, bytesLabel, dailyAverage, dayBreakdown, dayKeys, demoSnapshot, filterApps, peakDay, total } from '../src/traffic.ts'
import type { AppUsage, DayUsage } from '../src/traffic.ts'

const day = (date: string, wifi: number, mobile: number, wifiSent = 0, mobileSent = 0): DayUsage =>
  ({ date, wifi, mobile, wifiSent, mobileSent })
const app = (name: string, days: DayUsage[], permissions: AppUsage['permissions'] = []): AppUsage =>
  ({ id: name, name, packages: [`example.${name.toLowerCase()}`], days, permissions })

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

test('totals combine received and sent, or report one direction', () => {
  const days = [day('2026-01-01', 12, 4, 2, 1), day('2026-01-02', 5, 3, 5, 0)]
  assert.equal(total(days, 'all'), 24)
  assert.equal(total(days, 'wifi'), 17)
  assert.equal(total(days, 'mobile'), 7)
  assert.equal(total([], 'all'), 0)
  assert.equal(total(days, 'all', 'sent'), 8)
  assert.equal(total(days, 'all', 'received'), 16)
  assert.equal(total(days, 'wifi', 'received'), 10)
  assert.equal(total(days, 'mobile', 'sent'), 1)
  assert.equal(bytesFor(days[1], 'wifi', 'received'), 0)
  // Inconsistent counters never produce negative received bytes.
  assert.equal(bytesFor(day('2026-01-03', 1, 0, 2), 'wifi', 'received'), 0)
})

test('aggregation fills empty days, ignores dates outside the window, and sums app groups once', () => {
  const shared = app('Shared', [day('2026-01-01', 12, 4, 3, 1), day('2025-12-31', 99, 99, 9, 9)])
  const other = app('Other', [day('2026-01-01', 8, 0, 2)])
  assert.deepEqual(aggregate([shared, other], ['2026-01-01', '2026-01-02']), [
    day('2026-01-01', 20, 4, 5, 1),
    day('2026-01-02', 0, 0),
  ])
  assert.deepEqual(aggregate([], ['2026-01-01']), [day('2026-01-01', 0, 0)])
})

test('demo is explicit, deterministic, and matches the selected period', () => {
  const now = new Date('2026-01-01Z')
  const data = demoSnapshot(30, now)
  assert.deepEqual(data, demoSnapshot(30, now))
  assert.match(data.warnings[0], /Sample data only/)
  assert.equal(data.apps[0].days.length, 30)
  assert.ok(data.apps.every(app => app.packages[0].startsWith('example.demo.')))
  assert.ok(data.apps.every(app => app.days.every(day => day.wifiSent > 0 && day.wifiSent < day.wifi
    && day.mobileSent > 0 && day.mobileSent < day.mobile)))
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

test('app filters rank by direction, sensitive access, or name and can match permissions', () => {
  const camera = { id: 'android.permission.CAMERA', label: 'Take pictures', granted: true }
  const location = { id: 'android.permission.ACCESS_FINE_LOCATION', label: 'Precise location', granted: true }
  const internet = { id: 'android.permission.INTERNET', label: 'Full network access', granted: true }
  const apps = [
    app('Uploader', [day('2026-01-01', 10, 0, 9)], [camera, internet]),
    app('Streamer', [day('2026-01-01', 50, 0, 1)], [{ ...camera, granted: false }, internet]),
    app('Navigator', [day('2026-01-01', 20, 0, 2)], [camera, location]),
  ]
  const names = (list: AppUsage[]) => list.map(entry => entry.name)
  assert.deepEqual(names(filterApps(apps, '', 'all')), ['Streamer', 'Navigator', 'Uploader'])
  assert.deepEqual(names(filterApps(apps, '', 'all', { direction: 'sent' })), ['Uploader', 'Navigator', 'Streamer'])
  assert.deepEqual(names(filterApps(apps, '', 'all', { sort: 'sensitive' })), ['Navigator', 'Uploader', 'Streamer'])
  assert.deepEqual(names(filterApps(apps, '', 'all', { sort: 'name' })), ['Navigator', 'Streamer', 'Uploader'])
  // Only granted permissions count toward a category; requested-but-denied ones do not.
  assert.deepEqual(names(filterApps(apps, '', 'all', { category: 'camera' })), ['Navigator', 'Uploader'])
  assert.deepEqual(names(filterApps(apps, 'take pictures', 'all')), [])
  assert.deepEqual(names(filterApps(apps, 'take pictures', 'all', { matchPermissions: true })), ['Streamer', 'Navigator', 'Uploader'])
  assert.deepEqual(names(filterApps(apps, 'LOCATION', 'all', { matchPermissions: true })), ['Navigator'])
  assert.deepEqual(names(apps), ['Uploader', 'Streamer', 'Navigator'])
})

test('insights average every day in the window and find the earliest peak', () => {
  const days = [day('2026-01-01', 10, 2, 1), day('2026-01-02', 0, 0), day('2026-01-03', 12, 0, 6)]
  assert.equal(dailyAverage(days, 'all'), 8)
  assert.equal(dailyAverage(days, 'all', 'sent'), 7 / 3)
  assert.equal(dailyAverage([], 'all'), 0)
  assert.equal(peakDay(days, 'all')?.date, '2026-01-01')
  assert.equal(peakDay(days, 'wifi')?.date, '2026-01-03')
  assert.equal(peakDay(days, 'mobile', 'sent'), null)
  assert.equal(peakDay([], 'all'), null)
})

test('day breakdown lists app groups with traffic that day, highest first', () => {
  const apps = [
    app('Quiet', [day('2026-01-01', 0, 0), day('2026-01-02', 50, 0)]),
    app('Busy', [day('2026-01-01', 30, 5, 3)]),
    app('Also busy', [day('2026-01-01', 25, 10, 1)]),
  ]
  assert.deepEqual(dayBreakdown(apps, '2026-01-01', 'all').map(({ app, bytes }) => [app.name, bytes]),
    [['Also busy', 35], ['Busy', 35]])
  assert.deepEqual(dayBreakdown(apps, '2026-01-01', 'wifi', 'sent').map(({ app, bytes }) => [app.name, bytes]),
    [['Busy', 3], ['Also busy', 1]])
  assert.deepEqual(dayBreakdown(apps, '2026-01-03', 'all'), [])
})
