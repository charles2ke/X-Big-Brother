import type { AppUsage, DayUsage, Permission, Snapshot } from './traffic.ts'

/** Native data that breaks the bridge contract. None of it is shown. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}

type Fields = Record<string, unknown>

const fail = (message: string): never => { throw new SnapshotError(`Unexpected snapshot: ${message}`) }
const object = (value: unknown, path: string): Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Fields : fail(`${path} must be an object`)
const list = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : fail(`${path} must be an array`)
const text = (value: unknown, path: string): string => typeof value === 'string' ? value : fail(`${path} must be a string`)
const flag = (value: unknown, path: string): boolean => typeof value === 'boolean' ? value : fail(`${path} must be a boolean`)
const bytes = (value: unknown, path: string): number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  ? value : fail(`${path} must be a non-negative number`)
const unique = (seen: Set<string>, value: string, path: string) => {
  if (seen.has(value)) fail(`${path} repeats ${JSON.stringify(value)}`)
  seen.add(value)
}

function day(value: unknown, path: string, dates: Set<string>, background: boolean): DayUsage {
  const raw = object(value, path)
  const date = text(raw.date, `${path}.date`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`${path}.date must be a valid YYYY-MM-DD date`)
  const parsedDate = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    fail(`${path}.date must be a valid YYYY-MM-DD date`)
  }
  unique(dates, date, `${path}.date`)
  const field = (key: keyof DayUsage) => bytes(raw[key], `${path}.${key}`)
  const split = (key: keyof DayUsage) => background ? field(key) : 0
  const result: DayUsage = {
    date, wifi: field('wifi'), mobile: field('mobile'), wifiSent: field('wifiSent'), mobileSent: field('mobileSent'),
    wifiBackground: split('wifiBackground'), mobileBackground: split('mobileBackground'),
    wifiBackgroundSent: split('wifiBackgroundSent'), mobileBackgroundSent: split('mobileBackgroundSent'),
  }
  // Each part is a subset of Android's counters, so a larger part can only be a bridge bug.
  for (const kind of ['wifi', 'mobile'] as const) {
    const all = result[kind]
    const sent = result[`${kind}Sent`]
    const backgroundAll = result[`${kind}Background`]
    const backgroundSent = result[`${kind}BackgroundSent`]
    if (sent > all || backgroundAll > all || backgroundSent > sent || backgroundSent > backgroundAll
      || backgroundAll - backgroundSent > all - sent) fail(`${path} has inconsistent ${kind} counters`)
  }
  return result
}

function permission(value: unknown, path: string, ids: Set<string>): Permission {
  const raw = object(value, path)
  const id = text(raw.id, `${path}.id`)
  unique(ids, id, `${path}.id`)
  return { id, label: text(raw.label, `${path}.label`), granted: flag(raw.granted, `${path}.granted`) }
}

function app(value: unknown, path: string, ids: Set<string>, background: boolean): AppUsage {
  const raw = object(value, path)
  const id = text(raw.id, `${path}.id`)
  if (!id) fail(`${path}.id must not be empty`)
  unique(ids, id, `${path}.id`)
  const dates = new Set<string>()
  const permissions = new Set<string>()
  return {
    id,
    name: text(raw.name, `${path}.name`),
    packages: list(raw.packages, `${path}.packages`).map((entry, index) => text(entry, `${path}.packages[${index}]`)),
    days: list(raw.days, `${path}.days`).map((entry, index) => day(entry, `${path}.days[${index}]`, dates, background)),
    permissions: list(raw.permissions, `${path}.permissions`)
      .map((entry, index) => permission(entry, `${path}.permissions[${index}]`, permissions)),
  }
}

/**
 * Validates untrusted bridge data and copies only known fields, so malformed native output
 * fails with one clear error instead of crashing the dashboard or showing impossible numbers.
 */
export function parseSnapshot(value: unknown): Snapshot {
  const raw = object(value, 'snapshot')
  const generatedAt = text(raw.generatedAt, 'generatedAt')
  if (Number.isNaN(Date.parse(generatedAt))) fail('generatedAt must be a date')
  // Payloads without the foreground/background split stay usable; the split is then hidden.
  const backgroundAvailable = raw.backgroundAvailable === undefined ? false : flag(raw.backgroundAvailable, 'backgroundAvailable')
  const ids = new Set<string>()
  return {
    accessGranted: flag(raw.accessGranted, 'accessGranted'),
    generatedAt,
    backgroundAvailable,
    apps: list(raw.apps, 'apps').map((entry, index) => app(entry, `apps[${index}]`, ids, backgroundAvailable)),
    warnings: [...new Set(list(raw.warnings, 'warnings').map((entry, index) => text(entry, `warnings[${index}]`)))],
    unavailableNetworks: [...new Set(list(raw.unavailableNetworks, 'unavailableNetworks').map((entry, index) =>
      entry === 'wifi' || entry === 'mobile' ? entry : fail(`unavailableNetworks[${index}] must be wifi or mobile`)))],
  }
}
