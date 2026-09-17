import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Period, Snapshot } from './traffic'

interface TrafficPlugin {
  getSnapshot(options: { days: Period }): Promise<Snapshot>
  openUsageSettings(): Promise<void>
  openAppSettings(options: { packageName: string }): Promise<void>
}

export const platform = Capacitor.getPlatform()
export const TrafficMonitor = registerPlugin<TrafficPlugin>('TrafficMonitor')
export const DeviceSettings = registerPlugin<{ openAppSettings(): Promise<void> }>('DeviceSettings')
