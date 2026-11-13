import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedCategories, categorySummary, groupPermissions, matchesPermission, permissionCategory } from '../src/permissions.ts'
import type { AppUsage, Permission } from '../src/traffic.ts'

const permission = (name: string, granted = true, label = name): Permission =>
  ({ id: name.includes('.') ? name : `android.permission.${name}`, label, granted })
const app = (name: string, permissions: Permission[]): AppUsage =>
  ({ id: name, name, packages: [`example.${name}`], days: [], permissions })

test('runtime permissions map to Android permission groups; everything else is uncategorized', () => {
  assert.equal(permissionCategory('android.permission.ACCESS_BACKGROUND_LOCATION')?.label, 'Location')
  assert.equal(permissionCategory('android.permission.READ_MEDIA_VISUAL_USER_SELECTED')?.label, 'Photos & videos')
  assert.equal(permissionCategory('com.android.voicemail.permission.ADD_VOICEMAIL')?.label, 'Phone')
  assert.equal(permissionCategory('android.permission.health.READ_HEART_RATE')?.label, 'Health & body sensors')
  assert.equal(permissionCategory('android.permission.INTERNET'), null)
  assert.equal(permissionCategory('android.permission.SYSTEM_ALERT_WINDOW'), null)
  assert.equal(permissionCategory('com.example.permission.CAMERA'), null)
})

test('only granted permissions allow a category, each listed once in permission-manager order', () => {
  const allowed = allowedCategories(app('maps', [
    permission('POST_NOTIFICATIONS'), permission('ACCESS_COARSE_LOCATION'), permission('ACCESS_FINE_LOCATION'),
    permission('CAMERA', false), permission('INTERNET'),
  ]))
  assert.deepEqual(allowed.map(category => category.id), ['location', 'notifications'])
  assert.deepEqual(allowedCategories(app('none', [permission('CAMERA', false)])), [])
})

test('category summary counts each app group once and omits categories nobody is granted', () => {
  const summary = categorySummary([
    app('a', [permission('READ_CONTACTS'), permission('GET_ACCOUNTS'), permission('CAMERA')]),
    app('b', [permission('WRITE_CONTACTS'), permission('RECORD_AUDIO', false)]),
    app('c', [permission('INTERNET')]),
  ])
  assert.deepEqual(summary.map(({ category, apps }) => [category.id, apps]), [['camera', 1], ['contacts', 2]])
  assert.deepEqual(categorySummary([]), [])
})

test('permission groups list granted sensitive permissions first and keep other permissions separate', () => {
  const { sensitive, other } = groupPermissions([
    permission('WAKE_LOCK'), permission('READ_CONTACTS', false), permission('RECORD_AUDIO'),
    permission('CAMERA'), permission('INTERNET', false), permission('com.example.CUSTOM'),
  ])
  assert.deepEqual(sensitive.map(entry => entry.id.split('.').at(-1)), ['CAMERA', 'RECORD_AUDIO', 'READ_CONTACTS'])
  assert.deepEqual(other.map(entry => entry.id.split('.').at(-1)), ['CUSTOM', 'WAKE_LOCK', 'INTERNET'])
})

test('permission search matches labels, IDs, and category names of requested permissions', () => {
  const headphones = app('headphones', [permission('BLUETOOTH_CONNECT', false, 'Connect to paired devices')])
  assert.ok(matchesPermission(headphones, ' PAIRED '))
  assert.ok(matchesPermission(headphones, 'bluetooth_connect'))
  assert.ok(matchesPermission(headphones, 'nearby'))
  assert.ok(!matchesPermission(headphones, 'camera'))
  assert.ok(!matchesPermission(app('empty', []), ''))
})
