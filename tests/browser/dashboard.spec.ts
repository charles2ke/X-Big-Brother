import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { demoSnapshot } from '../../src/traffic'

test('browser starts honestly empty and makes no third-party requests', async ({ page }) => {
  const external: string[] = []
  const errors: string[] = []
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Know where your data goes.' })).toBeVisible()
  await expect(page.getByText('Your browser cannot read device traffic')).toBeVisible()
  await expect(page.getByText('No apps to show yet')).toBeVisible()
  await expect(page.getByText('Streamline', { exact: true })).toHaveCount(0)
  expect(external).toEqual([])
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('demo supports time windows, networks, app trends, search, permissions and exit', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore demo' }).click()
  await expect(page.getByText('Sample data · not your device traffic')).toBeVisible()
  await expect(page.locator('.app-row')).toHaveCount(6)
  await page.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(page.locator('.chart-column')).toHaveCount(30)
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mobile', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Search apps').fill('streamline')
  await expect(page.locator('.app-row')).toHaveCount(1)
  await page.locator('.app-row').click()
  await expect(page.getByRole('heading', { name: 'Streamline traffic' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage permissions in Settings' })).toBeDisabled()
  await page.getByText('View daily values', { exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(30)
  await page.getByLabel('Search apps').fill('not-an-app')
  await expect(page.getByText('No matching apps')).toBeVisible()
  await page.getByLabel('Search apps').fill('')
  await page.getByRole('button', { name: 'Show all apps' }).click()
  await page.getByRole('button', { name: 'All networks' }).click()
  await page.getByRole('button', { name: 'Last 7 days' }).click()
  await expect(page.locator('.chart-column')).toHaveCount(7)
  await page.getByText('View daily values', { exact: true }).click()
  await testInfo.attach('traffic-dashboard', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await page.getByRole('button', { name: 'App permissions', exact: true }).click()
  await page.getByRole('button', { name: /Social Club/ }).click()
  await expect(page.getByText('Camera', { exact: true })).toBeVisible()
  await expect(page.getByText('Granted', { exact: true }).first()).toBeVisible()
  await testInfo.attach('permissions-dashboard', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Exit demo' }).click()
  await expect(page.getByText('Your browser cannot read device traffic')).toBeVisible()
  await expect(page.locator('.app-row')).toHaveCount(0)
})

async function mockNative(page: Page, platform: 'android' | 'ios', options: { denied?: boolean; fail?: boolean; unavailable?: boolean } = {}) {
  const snapshot = demoSnapshot(7)
  snapshot.warnings = ['Only visible apps are included.']
  snapshot.accessGranted = !options.denied
  if (options.denied) snapshot.apps.forEach(app => { app.days = [] })
  if (options.unavailable) snapshot.unavailableNetworks = ['mobile']
  await page.addInitScript(({ platform, snapshot, options }) => {
    const target = window as unknown as Record<string, unknown>
    target.CapacitorCustomPlatform = { name: platform }
    target.nativeCalls = []
    target.Capacitor = {
      PluginHeaders: [
        { name: 'TrafficMonitor', methods: ['getSnapshot', 'openUsageSettings', 'openAppSettings'].map(name => ({ name, rtype: 'promise' })) },
        { name: 'DeviceSettings', methods: [{ name: 'openAppSettings', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin: string, method: string, args: unknown) => {
        (target.nativeCalls as unknown[]).push({ plugin, method, args })
        if (options.fail) throw new Error('Native unavailable')
        return method === 'getSnapshot' ? snapshot : undefined
      },
    }
  }, { platform, snapshot, options })
}

test('Android denied usage still lists permissions and routes to system settings', async ({ page }) => {
  await mockNative(page, 'android', { denied: true })
  await page.goto('/')
  await expect(page.getByText('Allow usage access to see traffic')).toBeVisible()
  await expect(page.locator('.app-row')).toHaveCount(6)
  await page.getByRole('button', { name: 'Open usage settings' }).click()
  await page.getByRole('button', { name: /Social Club/ }).click()
  await page.getByRole('button', { name: 'Manage permissions in Settings' }).click()
  const calls = await page.evaluate(() => (window as unknown as { nativeCalls: unknown[] }).nativeCalls)
  expect(calls).toContainEqual({ plugin: 'TrafficMonitor', method: 'openUsageSettings', args: undefined })
  expect(calls).toContainEqual({ plugin: 'TrafficMonitor', method: 'openAppSettings', args: { packageName: 'example.demo.socialclub' } })
})

test('Android transport failures never look like measured zero traffic', async ({ page }) => {
  await mockNative(page, 'android', { unavailable: true })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('mobile statistics are unavailable')
  await expect(page.getByText('Network statistics unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('.stat').nth(1)).toContainText('Unavailable')
  await page.getByRole('button', { name: 'Wi-Fi', exact: true }).click()
  await expect(page.locator('.chart-column')).toHaveCount(7)
})

test('native errors are actionable and do not silently load demo data', async ({ page }) => {
  await mockNative(page, 'android', { fail: true })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Unable to read device data')
  await expect(page.locator('.app-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open usage settings' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not open Settings')
})

test('iOS states restrictions and opens only its own app settings', async ({ page }) => {
  await mockNative(page, 'ios')
  await page.goto('/')
  await expect(page.getByText('iOS protects other apps’ activity')).toBeVisible()
  await expect(page.locator('.app-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open this app’s Settings' }).click()
  expect(await page.evaluate(() => (window as unknown as { nativeCalls: unknown[] }).nativeCalls))
    .toEqual([{ plugin: 'DeviceSettings', method: 'openAppSettings', args: undefined }])
})
