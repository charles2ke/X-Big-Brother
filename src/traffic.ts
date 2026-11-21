import { allowedCategories, matchesPermission } from './permissions.ts'
import type { CategoryId } from './permissions.ts'

export type Network = 'all' | 'wifi' | 'mobile'
export type Direction = 'both' | 'received' | 'sent'
/** Android's app-state split: traffic while the app was in the foreground, everything else (background), or both. */
export type Activity = 'all' | 'foreground' | 'background'
export type Period = 7 | 30
export type SortOrder = 'usage' | 'sensitive' | 'name'
/**
 * OS-reported bytes for one UTC day. `wifi`/`mobile` are received + sent; `*Sent` is the sent (upload) part.
 * `*Background` is the part Android did not attribute to the foreground, and `*BackgroundSent` its sent part.
 * Apps may omit days without traffic.
 */
export interface DayUsage {
  date: string
  wifi: number
  mobile: number
  wifiSent: number
  mobileSent: number
  wifiBackground: number
  mobileBackground: number
  wifiBackgroundSent: number
  mobileBackgroundSent: number
}
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
  /** False when the OS reported no foreground/background split; the `*Background*` fields are then placeholders. */
  backgroundAvailable: boolean
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

export function bytesFor(day: DayUsage, kind: 'wifi' | 'mobile', direction: Direction = 'both', activity: Activity = 'all'): number {
  const wifi = kind === 'wifi'
  let both = wifi ? day.wifi : day.mobile
  let sent = wifi ? day.wifiSent : day.mobileSent
  if (activity !== 'all') {
    const background = wifi ? day.wifiBackground : day.mobileBackground
    const backgroundSent = wifi ? day.wifiBackgroundSent : day.mobileBackgroundSent
    // Foreground is what remains after background, as in Android Settings.
    both = activity === 'background' ? background : both - background
    sent = activity === 'background' ? backgroundSent : sent - backgroundSent
  }
  // Inconsistent counters never produce negative bytes.
  return Math.max(0, direction === 'both' ? both : direction === 'sent' ? sent : both - sent)
}

/** One day's bytes for a network, direction, and app state. */
export function dayTotal(day: DayUsage, network: Network, direction: Direction = 'both', activity: Activity = 'all'): number {
  return (network !== 'mobile' ? bytesFor(day, 'wifi', direction, activity) : 0)
    + (network !== 'wifi' ? bytesFor(day, 'mobile', direction, activity) : 0)
}

export function total(usage: DayUsage[], network: Network, direction: Direction = 'both', activity: Activity = 'all'): number {
  let sum = 0
  for (const day of usage) sum += dayTotal(day, network, direction, activity)
  return sum
}

const counters = ['wifi', 'mobile', 'wifiSent', 'mobileSent',
  'wifiBackground', 'mobileBackground', 'wifiBackgroundSent', 'mobileBackgroundSent'] as const

/** Sums app groups per date in one pass over their days; dates without traffic are zero. */
export function aggregate(apps: AppUsage[], dates: string[]): DayUsage[] {
  const sums = new Map(dates.map(date => [date, { date, wifi: 0, mobile: 0, wifiSent: 0, mobileSent: 0,
    wifiBackground: 0, mobileBackground: 0, wifiBackgroundSent: 0, mobileBackgroundSent: 0 }]))
  for (const app of apps) {
    for (const day of app.days) {
      const sum = sums.get(day.date)
      if (sum) for (const key of counters) sum[key] += day[key]
    }
  }
  return dates.map(date => sums.get(date)!)
}

export interface AppFilter {
  direction?: Direction
  activity?: Activity
  sort?: SortOrder
  /** Keep only app groups allowed a permission in this sensitive category. */
  category?: CategoryId | null
  /** Also match requested permission labels, IDs, and categories. */
  matchPermissions?: boolean
}

// Same ordering as String#localeCompare with the default locale, without per-call locale resolution.
const collator = new Intl.Collator()
const byName = (a: AppUsage, b: AppUsage) => collator.compare(a.name, b.name)

export function filterApps(apps: AppUsage[], search: string, network: Network,
  { direction = 'both', activity = 'all', sort = 'usage', category = null, matchPermissions = false }: AppFilter = {}): AppUsage[] {
  const query = search.trim().toLocaleLowerCase()
  const rows = apps
    .filter(app => `${app.name} ${app.packages.join(' ')}`.toLocaleLowerCase().includes(query)
      || (matchPermissions && matchesPermission(app, query)))
    .map(app => ({
      app,
      usage: total(app.days, network, direction, activity),
      sensitive: allowedCategories(app),
      granted: app.permissions.filter(permission => permission.granted).length,
    }))
    .filter(row => !category || row.sensitive.some(entry => entry.id === category))
  return rows.sort((a, b) => sort === 'name' ? byName(a.app, b.app)
    : sort === 'sensitive' ? b.sensitive.length - a.sensitive.length || b.granted - a.granted || byName(a.app, b.app)
      : b.usage - a.usage || byName(a.app, b.app))
    .map(row => row.app)
}

export function dailyAverage(days: DayUsage[], network: Network, direction: Direction = 'both', activity: Activity = 'all'): number {
  return days.length === 0 ? 0 : total(days, network, direction, activity) / days.length
}

/** The day with the most traffic (earliest on ties), or null when nothing was recorded. */
export function peakDay(days: DayUsage[], network: Network, direction: Direction = 'both', activity: Activity = 'all'): DayUsage | null {
  let peak: DayUsage | null = null
  let most = 0
  for (const day of days) {
    const bytes = dayTotal(day, network, direction, activity)
    if (bytes > most) { peak = day; most = bytes }
  }
  return peak
}

/** App groups with traffic on one day, highest first. */
export function dayBreakdown(apps: AppUsage[], date: string, network: Network, direction: Direction = 'both', activity: Activity = 'all') {
  return apps.map(app => {
    let bytes = 0
    for (const day of app.days) if (day.date === date) bytes += dayTotal(day, network, direction, activity)
    return { app, bytes }
  })
    .filter(entry => entry.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || byName(a.app, b.app))
}

const grant = (id: string, label: string, granted = true): Permission =>
  ({ id: id.includes('.') ? id : `android.permission.${id}`, label, granted })

// Fictional apps: `upload` is the share of each app's traffic that is sent rather than received, and
// `background` the share Android would not attribute to the foreground.
const demoApps: { name: string; upload: number; background: number; permissions: Permission[] }[] = [
  { name: 'Streamline', upload: 0.04, background: 0.08, permissions: [grant('POST_NOTIFICATIONS', 'Notifications'),
    grant('RECORD_AUDIO', 'Microphone', false), grant('WAKE_LOCK', 'Prevent phone from sleeping')] },
  { name: 'Social Club', upload: 0.32, background: 0.35, permissions: [grant('CAMERA', 'Camera'),
    grant('RECORD_AUDIO', 'Microphone'), grant('READ_CONTACTS', 'Read your contacts'),
    grant('READ_MEDIA_IMAGES', 'Read photos'), grant('ACCESS_FINE_LOCATION', 'Precise location', false),
    grant('POST_NOTIFICATIONS', 'Notifications')] },
  { name: 'Web Browser', upload: 0.09, background: 0.05, permissions: [grant('CAMERA', 'Camera', false),
    grant('RECORD_AUDIO', 'Microphone', false), grant('ACCESS_FINE_LOCATION', 'Precise location', false)] },
  { name: 'Maps', upload: 0.14, background: 0.2, permissions: [grant('ACCESS_FINE_LOCATION', 'Precise location'),
    grant('ACCESS_COARSE_LOCATION', 'Approximate location'),
    grant('ACCESS_BACKGROUND_LOCATION', 'Location in the background', false), grant('RECORD_AUDIO', 'Microphone', false)] },
  { name: 'Music', upload: 0.02, background: 0.15, permissions: [grant('READ_MEDIA_AUDIO', 'Read audio files'),
    grant('BLUETOOTH_CONNECT', 'Connect to paired Bluetooth devices'),
    grant('POST_NOTIFICATIONS', 'Notifications', false), grant('WAKE_LOCK', 'Prevent phone from sleeping')] },
  { name: 'Mail', upload: 0.22, background: 0.7, permissions: [grant('READ_CONTACTS', 'Read your contacts'),
    grant('READ_CALENDAR', 'Read calendar events', false), grant('CAMERA', 'Camera', false),
    grant('POST_NOTIFICATIONS', 'Notifications')] },
]

export function demoSnapshot(days: Period, now = new Date()): Snapshot {
  return {
    accessGranted: true,
    generatedAt: now.toISOString(),
    unavailableNetworks: [],
    backgroundAvailable: true,
    warnings: ['Sample data only. These are fictional apps, not measurements from your device.'],
    apps: demoApps.map(({ name, upload, background, permissions }, index) => ({
      id: `demo-${index}`,
      name,
      packages: [`example.demo.${name.toLowerCase().replaceAll(' ', '')}`],
      days: dayKeys(days, now).map((date, day) => {
        const wifi = Math.round((7 - index) * (1 + ((day * 7 + index * 3) % 11) / 10) * 19_000_000)
        const mobile = Math.round((6 - index) * (1 + ((day * 3 + index) % 7) / 10) * 4_000_000)
        const sentShare = upload * (0.8 + ((day + index) % 5) / 10)
        const wifiSent = Math.round(wifi * sentShare)
        const mobileSent = Math.round(mobile * sentShare)
        // One share for received and sent keeps every background part within its total.
        const share = background * (0.85 + ((day * 5 + index * 2) % 4) / 10)
        return { date, wifi, mobile, wifiSent, mobileSent,
          wifiBackground: Math.round(wifi * share), mobileBackground: Math.round(mobile * share),
          wifiBackgroundSent: Math.round(wifiSent * share), mobileBackgroundSent: Math.round(mobileSent * share) }
      }),
      // Every demo app also holds the routine permissions nearly every Android app is granted at install.
      permissions: [grant('INTERNET', 'Have full network access'),
        grant('ACCESS_NETWORK_STATE', 'View network connections'), ...permissions],
    })),
  }
}
