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
  await page.locator('.chart-column').nth(1).click()
  await expect(page.locator('#day-details .day-apps li')).toHaveCount(5)
  const trafficScreenshot = testInfo.outputPath('traffic-dashboard.png')
  await page.screenshot({ path: trafficScreenshot, fullPage: true })
  await testInfo.attach('traffic-dashboard', { path: trafficScreenshot, contentType: 'image/png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'App permissions', exact: true }).click()
  await page.getByRole('button', { name: /Social Club/ }).click()
  await expect(page.locator('.app-detail').getByText('Camera', { exact: true })).toBeVisible()
  await expect(page.getByText('Granted', { exact: true }).first()).toBeVisible()
  const permissionsScreenshot = testInfo.outputPath('permissions-dashboard.png')
  await page.screenshot({ path: permissionsScreenshot, fullPage: true })
  await testInfo.attach('permissions-dashboard', { path: permissionsScreenshot, contentType: 'image/png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Exit demo' }).click()
  await expect(page.getByText('Your browser cannot read device traffic')).toBeVisible()
  await expect(page.locator('.app-row')).toHaveCount(0)
})

test('demo splits received and sent traffic and drills into one day’s top apps', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore demo' }).click()
  const names = page.locator('.app-row .app-name > strong')
  const insights = page.locator('.insights')
  await expect(insights).toContainText('Daily average')
  await expect(insights).toContainText('Received / sent')
  const sent = page.getByRole('button', { name: 'Sent', exact: true })
  await sent.click()
  await expect(sent).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.chart-meta')).toContainText('combined traffic sent')
  await expect(insights).toContainText('Sent share')
  await expect(names.first()).toHaveText('Social Club')
  await expect(names.nth(1)).toHaveText('Maps')
  await expect(page.locator('.app-row').first()).toContainText('of its traffic')
  await page.getByText('View daily values', { exact: true }).click()
  await expect(page.locator('caption')).toHaveText('Daily sent bytes, UTC')
  await page.getByRole('button', { name: 'Received + sent', exact: true }).click()
  await expect(names.first()).toHaveText('Streamline')

  const columns = page.locator('.chart-column')
  const details = page.locator('#day-details')
  const peakDate = (await insights.locator('div', { hasText: 'Peak day' }).locator('small').innerText()).replace(/^on /, '')
  const peakColumn = page.getByRole('button', { name: `${peakDate}:` })
  await peakColumn.click()
  await expect(peakColumn).toHaveAttribute('aria-pressed', 'true')
  await expect(details.getByRole('heading', { level: 3 })).toContainText(`Top apps · ${peakDate}`)
  await expect(details.locator('.day-apps li')).toHaveCount(5)
  await expect(details).toContainText('+1 more app group')
  await expect(page.locator('[aria-live="polite"]')).toContainText('Showing top apps for')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.keyboard.press('Home')
  await expect(columns.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(columns.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(columns.last()).toBeFocused()
  await expect(columns.last()).toHaveAttribute('tabindex', '0')
  await expect(columns.first()).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('Enter')
  await expect(columns.last()).toHaveAttribute('aria-pressed', 'true')
  await expect(peakColumn).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Close day' }).click()
  await expect(details).toHaveCount(0)
  await expect(columns.last()).toBeFocused()

  await page.getByRole('button', { name: /^Streamline/ }).click()
  await columns.last().click()
  await expect(details.locator('.day-apps li.current')).toHaveText(/^Streamline/)

  await page.getByRole('button', { name: 'App permissions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'App permission inventory' })).toBeVisible()
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Sample data updated. 6 app groups listed.')
  await page.getByRole('button', { name: 'Traffic overview' }).click()
  await expect(details.locator('.day-apps li.current')).toHaveText(/^Streamline/)
})

test('demo permissions summarize sensitive access and filter by category or permission', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore demo' }).click()
  await page.getByRole('button', { name: 'App permissions', exact: true }).click()
  const names = page.locator('.app-row .app-name > strong')
  await expect(page.locator('.stat').nth(3).locator('strong')).toHaveText('5')
  await expect(names).toHaveText(['Social Club', 'Music', 'Mail', 'Maps', 'Streamline', 'Web Browser'])
  await expect(page.locator('.app-row').first()).toContainText('7 grants')

  const contacts = page.getByRole('button', { name: 'Contacts 2 of 6 app groups' })
  await contacts.click()
  await expect(contacts).toHaveAttribute('aria-pressed', 'true')
  await expect(names).toHaveText(['Social Club', 'Mail'])
  await expect(page.locator('.list-meta')).toContainText('2 app groups with Contacts access')
  await page.getByLabel('Search apps').fill('nearby')
  await expect(page.getByText('No matching apps')).toBeVisible()
  await expect(page.getByText('Try another app name, package ID, or permission, or clear the filter.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect(contacts).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.list-meta small')).toBeFocused()
  await expect(names).toHaveText(['Music'])
  await page.getByLabel('Search apps').fill('microphone')
  await expect(names).toHaveText(['Social Club', 'Maps', 'Streamline', 'Web Browser'])
  await page.getByLabel('Search apps').fill('')
  await page.getByLabel('Sort apps').selectOption('name')
  await expect(names).toHaveText(['Mail', 'Maps', 'Music', 'Social Club', 'Streamline', 'Web Browser'])

  await page.getByRole('button', { name: /^Social Club/ }).click()
  const detail = page.locator('.app-detail')
  await expect(detail.locator('.permission strong').first()).toHaveText('Camera')
  await expect(detail.getByText('Have full network access')).toBeHidden()
  await detail.getByText('Other permissions (2)').click()
  await expect(detail.getByText('Have full network access')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Traffic overview' }).click()
  await expect(page.getByLabel('Sort apps')).toHaveValue('usage')
  await expect(names.first()).toHaveText('Streamline')
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
  await expect(page.locator('.stat').nth(1).locator('.split')).toHaveCount(0)
  await expect(page.locator('.stat').first().locator('.split')).toContainText('sent')
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
