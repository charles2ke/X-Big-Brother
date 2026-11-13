import { allowedCategories, matchesPermission } from './permissions.ts'
import type { CategoryId } from './permissions.ts'

export type Network = 'all' | 'wifi' | 'mobile'
export type Direction = 'both' | 'received' | 'sent'
export type Period = 7 | 30
export type SortOrder = 'usage' | 'sensitive' | 'name'
/** OS-reported bytes for one UTC day. `wifi`/`mobile` are received + sent; `*Sent` is the sent (upload) part. */
export interface DayUsage { date: string; wifi: number; mobile: number; wifiSent: number; mobileSent: number }
export interface Permission { id: string; label: string; granted: boolean }
export interface AppUsage {
  id: string
  name: string
  packages: string[]
  days: DayUsage[]
  permissions: Permission[]
}
export interface Snapshot {
  accessGranted: boolean
  generatedAt: string
  apps: AppUsage[]
  warnings: string[]
  unavailableNetworks: ('wifi' | 'mobile')[]
}

export function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

export function dayKeys(days: Period, now = new Date()): string[] {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: days }, (_, i) =>
    new Date(midnight - (days - i - 1) * 86_400_000).toISOString().slice(0, 10))
}

export function bytesFor(day: DayUsage, kind: 'wifi' | 'mobile', direction: Direction = 'both'): number {
  const sent = kind === 'wifi' ? day.wifiSent : day.mobileSent
  return direction === 'both' ? day[kind] : direction === 'sent' ? sent : Math.max(0, day[kind] - sent)
}

export function total(usage: DayUsage[], network: Network, direction: Direction = 'both'): number {
  return usage.reduce((sum, day) => sum +
    (network !== 'mobile' ? bytesFor(day, 'wifi', direction) : 0) +
    (network !== 'wifi' ? bytesFor(day, 'mobile', direction) : 0), 0)
}

export function aggregate(apps: AppUsage[], dates: string[]): DayUsage[] {
  return dates.map(date => apps.reduce((sum, app) => {
    const day = app.days.find(entry => entry.date === date)
    return {
      date,
      wifi: sum.wifi + (day?.wifi ?? 0),
      mobile: sum.mobile + (day?.mobile ?? 0),
      wifiSent: sum.wifiSent + (day?.wifiSent ?? 0),
      mobileSent: sum.mobileSent + (day?.mobileSent ?? 0),
    }
  }, { date, wifi: 0, mobile: 0, wifiSent: 0, mobileSent: 0 }))
}

export interface AppFilter {
  direction?: Direction
  sort?: SortOrder
  /** Keep only app groups allowed a permission in this sensitive category. */
  category?: CategoryId | null
  /** Also match requested permission labels, IDs, and categories. */
  matchPermissions?: boolean
}

export function filterApps(apps: AppUsage[], search: string, network: Network,
  { direction = 'both', sort = 'usage', category = null, matchPermissions = false }: AppFilter = {}): AppUsage[] {
  const query = search.trim().toLocaleLowerCase()
  const rows = apps
    .filter(app => `${app.name} ${app.packages.join(' ')}`.toLocaleLowerCase().includes(query)
      || (matchPermissions && matchesPermission(app, query)))
    .map(app => ({
      app,
      usage: total(app.days, network, direction),
      sensitive: allowedCategories(app),
      granted: app.permissions.filter(permission => permission.granted).length,
    }))
    .filter(row => !category || row.sensitive.some(entry => entry.id === category))
  const byName = (a: AppUsage, b: AppUsage) => a.name.localeCompare(b.name)
  return rows.sort((a, b) => sort === 'name' ? byName(a.app, b.app)
    : sort === 'sensitive' ? b.sensitive.length - a.sensitive.length || b.granted - a.granted || byName(a.app, b.app)
      : b.usage - a.usage || byName(a.app, b.app))
    .map(row => row.app)
}

export function dailyAverage(days: DayUsage[], network: Network, direction: Direction = 'both'): number {
  return days.length === 0 ? 0 : total(days, network, direction) / days.length
}

/** The day with the most traffic (earliest on ties), or null when nothing was recorded. */
export function peakDay(days: DayUsage[], network: Network, direction: Direction = 'both'): DayUsage | null {
  let peak: DayUsage | null = null
  for (const day of days) {
    if (total([day], network, direction) > (peak ? total([peak], network, direction) : 0)) peak = day
  }
  return peak
}

/** App groups with traffic on one day, highest first. */
export function dayBreakdown(apps: AppUsage[], date: string, network: Network, direction: Direction = 'both') {
  return apps.map(app => ({ app, bytes: total(app.days.filter(day => day.date === date), network, direction) }))
    .filter(entry => entry.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.app.name.localeCompare(b.app.name))
}

const grant = (id: string, label: string, granted = true): Permission =>
  ({ id: id.includes('.') ? id : `android.permission.${id}`, label, granted })

// Fictional apps: `upload` is the share of each app's traffic that is sent rather than received.
const demoApps: { name: string; upload: number; permissions: Permission[] }[] = [
  { name: 'Streamline', upload: 0.04, permissions: [grant('POST_NOTIFICATIONS', 'Notifications'),
    grant('RECORD_AUDIO', 'Microphone', false), grant('WAKE_LOCK', 'Prevent phone from sleeping')] },
  { name: 'Social Club', upload: 0.32, permissions: [grant('CAMERA', 'Camera'), grant('RECORD_AUDIO', 'Microphone'),
    grant('READ_CONTACTS', 'Read your contacts'), grant('READ_MEDIA_IMAGES', 'Read photos'),
    grant('ACCESS_FINE_LOCATION', 'Precise location', false), grant('POST_NOTIFICATIONS', 'Notifications')] },
  { name: 'Web Browser', upload: 0.09, permissions: [grant('CAMERA', 'Camera', false),
    grant('RECORD_AUDIO', 'Microphone', false), grant('ACCESS_FINE_LOCATION', 'Precise location', false)] },
  { name: 'Maps', upload: 0.14, permissions: [grant('ACCESS_FINE_LOCATION', 'Precise location'),
    grant('ACCESS_COARSE_LOCATION', 'Approximate location'),
    grant('ACCESS_BACKGROUND_LOCATION', 'Location in the background', false), grant('RECORD_AUDIO', 'Microphone', false)] },
  { name: 'Music', upload: 0.02, permissions: [grant('READ_MEDIA_AUDIO', 'Read audio files'),
    grant('BLUETOOTH_CONNECT', 'Connect to paired Bluetooth devices'),
    grant('POST_NOTIFICATIONS', 'Notifications', false), grant('WAKE_LOCK', 'Prevent phone from sleeping')] },
  { name: 'Mail', upload: 0.22, permissions: [grant('READ_CONTACTS', 'Read your contacts'),
    grant('READ_CALENDAR', 'Read calendar events', false), grant('CAMERA', 'Camera', false),
    grant('POST_NOTIFICATIONS', 'Notifications')] },
]

export function demoSnapshot(days: Period, now = new Date()): Snapshot {
  return {
    accessGranted: true,
    generatedAt: now.toISOString(),
    unavailableNetworks: [],
    warnings: ['Sample data only. These are fictional apps, not measurements from your device.'],
    apps: demoApps.map(({ name, upload, permissions }, index) => ({
      id: `demo-${index}`,
      name,
      packages: [`example.demo.${name.toLowerCase().replaceAll(' ', '')}`],
      days: dayKeys(days, now).map((date, day) => {
        const wifi = Math.round((7 - index) * (1 + ((day * 7 + index * 3) % 11) / 10) * 19_000_000)
        const mobile = Math.round((6 - index) * (1 + ((day * 3 + index) % 7) / 10) * 4_000_000)
        const sentShare = upload * (0.8 + ((day + index) % 5) / 10)
        return { date, wifi, mobile, wifiSent: Math.round(wifi * sentShare), mobileSent: Math.round(mobile * sentShare) }
      }),
      // Every demo app also holds the routine permissions nearly every Android app is granted at install.
      permissions: [grant('INTERNET', 'Have full network access'),
        grant('ACCESS_NETWORK_STATE', 'View network connections'), ...permissions],
    })),
  }
}
