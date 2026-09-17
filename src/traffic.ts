export type Network = 'all' | 'wifi' | 'mobile'
export type Period = 7 | 30
export interface DayUsage { date: string; wifi: number; mobile: number }
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

export function total(usage: DayUsage[], network: Network): number {
  return usage.reduce((sum, day) => sum +
    (network !== 'mobile' ? day.wifi : 0) + (network !== 'wifi' ? day.mobile : 0), 0)
}

export function aggregate(apps: AppUsage[], dates: string[]): DayUsage[] {
  return dates.map(date => apps.reduce((sum, app) => {
    const day = app.days.find(entry => entry.date === date)
    return { date, wifi: sum.wifi + (day?.wifi ?? 0), mobile: sum.mobile + (day?.mobile ?? 0) }
  }, { date, wifi: 0, mobile: 0 }))
}

export function filterApps(apps: AppUsage[], search: string, network: Network): AppUsage[] {
  const query = search.trim().toLocaleLowerCase()
  return apps.filter(app => `${app.name} ${app.packages.join(' ')}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => total(b.days, network) - total(a.days, network) || a.name.localeCompare(b.name))
}

export function demoSnapshot(days: Period, now = new Date()): Snapshot {
  const names = ['Streamline', 'Social Club', 'Web Browser', 'Maps', 'Music', 'Mail']
  return {
    accessGranted: true,
    generatedAt: now.toISOString(),
    unavailableNetworks: [],
    warnings: ['Sample data only. These are fictional apps, not measurements from your device.'],
    apps: names.map((name, index) => ({
      id: `demo-${index}`,
      name,
      packages: [`example.demo.${name.toLowerCase().replaceAll(' ', '')}`],
      days: dayKeys(days, now).map((date, day) => ({
        date,
        wifi: Math.round((7 - index) * (1 + ((day * 7 + index * 3) % 11) / 10) * 19_000_000),
        mobile: Math.round((6 - index) * (1 + ((day * 3 + index) % 7) / 10) * 4_000_000),
      })),
      permissions: [
        { id: 'android.permission.CAMERA', label: 'Camera', granted: index % 2 === 1 },
        { id: 'android.permission.ACCESS_FINE_LOCATION', label: 'Precise location', granted: index === 3 },
        { id: 'android.permission.RECORD_AUDIO', label: 'Microphone', granted: index === 1 },
      ],
    })),
  }
}
