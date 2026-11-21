import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Period } from './traffic'

interface TrafficPlugin {
  /** Untrusted bridge data; validate it with parseSnapshot before use. */
  getSnapshot(options: { days: Period }): Promise<unknown>
  openUsageSettings(): Promise<void>
  openAppSettings(options: { packageName: string }): Promise<void>
}

export const platform = Capacitor.getPlatform()
export const TrafficMonitor = registerPlugin<TrafficPlugin>('TrafficMonitor')
export const DeviceSettings = registerPlugin<{ openAppSettings(): Promise<void> }>('DeviceSettings')
