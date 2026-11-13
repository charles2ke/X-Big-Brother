import type { AppUsage, Permission } from './traffic.ts'

export type CategoryId = 'camera' | 'microphone' | 'location' | 'contacts' | 'calendar' | 'sms' | 'phone'
  | 'call-logs' | 'photos' | 'audio' | 'files' | 'nearby' | 'health' | 'activity' | 'notifications'
export interface PermissionCategory { id: CategoryId; label: string }
export interface CategoryCount { category: PermissionCategory; apps: number }

const android = (...names: string[]) => names.map(name => `android.permission.${name}`)

// Android runtime ("dangerous") permissions, in the groups and order Android's permission manager uses.
// Anything else (install-time, special access, OEM/custom permissions) is reported as "other".
const groups: [CategoryId, string, string[]][] = [
  ['camera', 'Camera', android('CAMERA')],
  ['microphone', 'Microphone', android('RECORD_AUDIO')],
  ['location', 'Location', android('ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION')],
  ['contacts', 'Contacts', android('READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS')],
  ['calendar', 'Calendar', android('READ_CALENDAR', 'WRITE_CALENDAR')],
  ['sms', 'SMS', android('SEND_SMS', 'RECEIVE_SMS', 'READ_SMS', 'RECEIVE_MMS', 'RECEIVE_WAP_PUSH')],
  ['phone', 'Phone', [...android('READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE', 'ANSWER_PHONE_CALLS',
    'USE_SIP', 'ACCEPT_HANDOVER'), 'com.android.voicemail.permission.ADD_VOICEMAIL']],
  ['call-logs', 'Call logs', android('READ_CALL_LOG', 'WRITE_CALL_LOG', 'PROCESS_OUTGOING_CALLS')],
  ['photos', 'Photos & videos', android('READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED',
    'ACCESS_MEDIA_LOCATION')],
  ['audio', 'Music & audio', android('READ_MEDIA_AUDIO')],
  ['files', 'Files', android('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE')],
  ['nearby', 'Nearby devices', android('BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE',
    'NEARBY_WIFI_DEVICES', 'UWB_RANGING', 'RANGING')],
  ['health', 'Health & body sensors', android('BODY_SENSORS', 'BODY_SENSORS_BACKGROUND')],
  ['activity', 'Physical activity', android('ACTIVITY_RECOGNITION')],
  ['notifications', 'Notifications', android('POST_NOTIFICATIONS')],
]

export const categories: readonly PermissionCategory[] = groups.map(([id, label]) => ({ id, label }))
const byPermission = new Map(groups.flatMap(([id, , permissions]) =>
  permissions.map(permission => [permission, categories.find(category => category.id === id)!] as const)))
const healthCategory = categories.find(category => category.id === 'health')!

export function permissionCategory(id: string): PermissionCategory | null {
  // Android 16 replaces body-sensor permissions with granular android.permission.health.* runtime permissions.
  return byPermission.get(id) ?? (id.startsWith('android.permission.health.') ? healthCategory : null)
}

/** Sensitive categories with at least one granted permission, in permission-manager order. */
export function allowedCategories(app: AppUsage): PermissionCategory[] {
  const allowed = new Set(app.permissions.filter(permission => permission.granted)
    .map(permission => permissionCategory(permission.id)?.id))
  return categories.filter(category => allowed.has(category.id))
}

/** How many app groups are allowed each sensitive category; categories nobody holds are omitted. */
export function categorySummary(apps: AppUsage[]): CategoryCount[] {
  const allowed = apps.map(app => allowedCategories(app))
  return categories.map(category => ({ category, apps: allowed.filter(list => list.includes(category)).length }))
    .filter(entry => entry.apps > 0)
}

/** Sensitive permissions first (granted, then by category), with everything else kept separately. */
export function groupPermissions(permissions: Permission[]): { sensitive: Permission[]; other: Permission[] } {
  const rank = (permission: Permission) => categories.indexOf(permissionCategory(permission.id)!)
  return {
    sensitive: permissions.filter(permission => permissionCategory(permission.id))
      .sort((a, b) => Number(b.granted) - Number(a.granted) || rank(a) - rank(b) || a.label.localeCompare(b.label)),
    other: permissions.filter(permission => !permissionCategory(permission.id))
      .sort((a, b) => Number(b.granted) - Number(a.granted) || a.label.localeCompare(b.label)),
  }
}

/** Case-insensitive match on any requested permission's label, ID, or sensitive category. */
export function matchesPermission(app: AppUsage, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  return app.permissions.some(permission =>
    `${permission.label} ${permission.id} ${permissionCategory(permission.id)?.label ?? ''}`
      .toLocaleLowerCase().includes(query))
}
