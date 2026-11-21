import { test, expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
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
  if (testInfo.project.name === 'mobile') {
    await expect.poll(() => page.locator('.chart-column').first().evaluate(column => column.getBoundingClientRect().width)).toBeGreaterThanOrEqual(40)
    await expect.poll(() => page.locator('.chart').evaluate(chart => chart.scrollWidth > chart.clientWidth)).toBe(true)
  }
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
  // The daily table stays as the user left it while the new range loads.
  const table = page.locator('details.data-table')
  await expect(table).toHaveAttribute('open', '')
  await page.getByText('View daily values', { exact: true }).click()
  await expect(table).not.toHaveAttribute('open')
  await page.locator('.chart-column').nth(1).click()
  await expect(page.locator('#day-details .day-apps li')).toHaveCount(5)
  await capture(page, testInfo, 'traffic-dashboard')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  const permissionsPage = page.getByRole('button', { name: 'App permissions', exact: true })
  await permissionsPage.click()
  await expect(permissionsPage).toHaveAttribute('aria-current', 'page')
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await page.getByRole('button', { name: /Social Club/ }).click()
  await expect(page.locator('.app-detail').getByText('Camera', { exact: true })).toBeVisible()
  await expect(page.getByText('Granted', { exact: true }).first()).toBeVisible()
  await capture(page, testInfo, 'permissions-dashboard')
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

test('demo splits traffic by Android app state', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore demo' }).click()
  const names = page.locator('.app-row .app-name > strong')
  const insights = page.locator('.insights')
  const meta = page.locator('.chart-meta')
  const note = page.locator('.state-note')
  const states = page.getByRole('group', { name: 'App state' })
  const backgroundShare = insights.locator('div', { hasText: 'Background share' })
  await expect(backgroundShare).toContainText('20%')
  await expect(backgroundShare).toContainText('of 5.7 GB received + sent')
  await expect(note).toHaveCount(0)

  const background = states.getByRole('button', { name: 'Background' })
  await background.click()
  await expect(background).toHaveAttribute('aria-pressed', 'true')
  await expect(meta).toContainText('1.2 GB')
  await expect(meta).toContainText('combined background traffic')
  await expect(note).toContainText('foreground covers apps on screen or running a foreground service')
  await expect(backgroundShare).toContainText('of 5.7 GB in all app states')
  await expect(names).toHaveText(['Social Club', 'Mail', 'Maps', 'Streamline', 'Music', 'Web Browser'])
  await expect(page.locator('.app-row', { hasText: 'Mail' })).toContainText('70% of its traffic')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await capture(page, testInfo, 'app-state-dashboard')

  await page.getByRole('button', { name: 'Sent', exact: true }).click()
  await expect(meta).toContainText('combined background traffic sent')
  await expect(insights).toContainText('Background sent share')
  await expect(insights).toContainText('of 5.7 GB received + sent in all app states')
  await expect(names.first()).toHaveText('Social Club')
  await expect(names.nth(1)).toHaveText('Mail')
  await page.getByText('View daily values', { exact: true }).click()
  await expect(page.locator('caption')).toHaveText('Daily background sent bytes, UTC')

  await page.getByRole('button', { name: 'Received + sent', exact: true }).click()
  await states.getByRole('button', { name: 'Foreground' }).click()
  await expect(meta).toContainText('combined foreground traffic')
  await expect(names.first()).toHaveText('Streamline')
  await expect(names.nth(1)).toHaveText('Web Browser')
  await states.getByRole('button', { name: 'All app states' }).click()
  await expect(note).toHaveCount(0)
  await expect(page.locator('caption')).toHaveText('Daily received + sent bytes, UTC')

  await page.getByRole('button', { name: 'App permissions', exact: true }).click()
  await expect(states).toHaveCount(0)
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

type NativeOptions = { denied?: boolean; fail?: boolean; unavailable?: boolean; payload?: unknown }
type NativeWindow = { nativeCalls: { plugin: string; method: string; args: unknown }[]; nextRead?: 'hold' | 'fail' | 'busy'; release?: () => void }

async function mockNative(page: Page, platform: 'android' | 'ios', options: NativeOptions = {}) {
  const snapshot = demoSnapshot(7)
  snapshot.warnings = ['Only visible apps are included.']
  snapshot.accessGranted = !options.denied
  if (options.denied) snapshot.apps.forEach(app => { app.days = [] })
  if (options.unavailable) snapshot.unavailableNetworks = ['mobile']
  await page.addInitScript(({ platform, payload, fail }) => {
    const target = window as unknown as Record<string, unknown> & NativeWindow
    target.CapacitorCustomPlatform = { name: platform }
    target.nativeCalls = []
    target.Capacitor = {
      PluginHeaders: [
        { name: 'TrafficMonitor', methods: ['getSnapshot', 'openUsageSettings', 'openAppSettings'].map(name => ({ name, rtype: 'promise' })) },
        { name: 'DeviceSettings', methods: [{ name: 'openAppSettings', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin: string, method: string, args: unknown) => {
        target.nativeCalls.push({ plugin, method, args })
        if (fail) throw new Error('Native unavailable')
        if (method !== 'getSnapshot') return undefined
        // A test can script the next read: hold it until release(), or reject it as the plugin does.
        const next = target.nextRead
        target.nextRead = undefined
        if (next === 'busy') throw Object.assign(new Error('A snapshot is already being read.'), { code: 'BUSY' })
        if (next === 'fail') throw Object.assign(new Error('Unable to read snapshot.'), { code: 'SNAPSHOT_FAILED' })
        if (next === 'hold') await new Promise(resolve => { target.release = () => resolve(undefined) })
        return payload
      },
    }
  }, { platform, payload: options.payload ?? snapshot, fail: options.fail })
}

const nextRead = (page: Page, next: NativeWindow['nextRead']) =>
  page.evaluate(next => { (window as unknown as NativeWindow).nextRead = next }, next)
const snapshotReads = (page: Page) =>
  page.evaluate(() => (window as unknown as NativeWindow).nativeCalls.filter(call => call.method === 'getSnapshot').length)

// Full-page captures paint beyond the viewport, where Chromium skips content-visibility rows; render them as scrolling would.
// They also draw the fixed sidebar wherever the last scroll left it, so capture from the top.
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path, fullPage: true, style: '.app-item { content-visibility: visible }' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
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

test('Android refresh keeps the current snapshot on screen and focus on Refresh', async ({ page }) => {
  await mockNative(page, 'android')
  await page.goto('/')
  const rows = page.locator('.app-row')
  const refresh = page.locator('.refresh')
  await expect(rows).toHaveCount(6)
  await nextRead(page, 'hold')
  await refresh.focus()
  await page.keyboard.press('Enter')
  await expect(refresh).toHaveText('Reading…')
  await expect(refresh).toHaveAttribute('aria-disabled', 'true')
  await expect(refresh).toBeFocused()
  await expect(rows).toHaveCount(6)
  // Repeated presses and period changes wait for the read in flight instead of starting another.
  await page.keyboard.press('Enter')
  const longer = page.getByRole('button', { name: 'Last 30 days' })
  await longer.click({ force: true })
  await expect(longer).toBeFocused()
  await expect(longer).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => (window as unknown as NativeWindow).release?.())
  await expect(refresh).toHaveText('↻ Refresh')
  await expect(refresh).toHaveAttribute('aria-disabled', 'false')
  await expect(rows).toHaveCount(6)
  expect(await snapshotReads(page)).toBe(2)
})

test('Android launches and range changes read as loading, never as missing access', async ({ page }) => {
  await mockNative(page, 'android')
  // Mutation callbacks run at each microtask checkpoint, so they also catch states replaced before the next paint.
  await page.addInitScript(() => {
    const target = window as unknown as { sawNotice: boolean; announcements: string[] }
    target.sawNotice = false
    target.announcements = []
    new MutationObserver(() => {
      if (document.body?.textContent?.includes('Allow usage access')) target.sawNotice = true
      const announcement = document.querySelector('[aria-live="polite"]')?.textContent
      if (announcement && target.announcements.at(-1) !== announcement) target.announcements.push(announcement)
    }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  await page.goto('/')
  await expect(page.locator('.app-row')).toHaveCount(6)
  const table = page.locator('details.data-table')
  await page.getByText('View daily values', { exact: true }).click()
  await page.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(page.locator('.chart-column')).toHaveCount(30)
  await expect(table).toHaveAttribute('open', '')
  await expect(page.locator('tbody tr')).toHaveCount(30)
  const seen = await page.evaluate(() => {
    const { sawNotice, announcements } = window as unknown as { sawNotice: boolean; announcements: string[] }
    return { sawNotice, announcements }
  })
  expect(seen.sawNotice).toBe(false)
  expect(seen.announcements).toEqual([
    'Reading device data…', 'Device data updated. 6 app groups listed.',
    'Reading device data…', 'Device data updated. 6 app groups listed.',
  ])
})

test('failed Android refreshes clear old data and say what to do next', async ({ page }) => {
  await mockNative(page, 'android')
  await page.goto('/')
  const rows = page.locator('.app-row')
  const alert = page.getByRole('alert')
  await expect(rows).toHaveCount(6)
  await nextRead(page, 'busy')
  await page.locator('.refresh').click()
  await expect(alert).toHaveText(/Android is still reading the previous snapshot/)
  await expect(rows).toHaveCount(0)
  await expect(page.getByText('Allow usage access to see traffic')).toHaveCount(0)
  await nextRead(page, 'fail')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(alert).toContainText('Unable to read device data')
  await expect(rows).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open usage settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).press('Enter')
  await expect(page.locator('.refresh')).toBeFocused()
  await expect(alert).toHaveCount(0)
  await expect(rows).toHaveCount(6)
})

test('malformed Android data is rejected rather than partly shown', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const payload = demoSnapshot(7)
  payload.apps[0].days[0].wifiSent = payload.apps[0].days[0].wifi + 1
  await mockNative(page, 'android', { payload })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Device data arrived in an unexpected format, so none of it is shown.')
  await expect(page.locator('.app-row')).toHaveCount(0)
  await expect(page.locator('.stat').first().locator('strong')).toHaveText('—')
  await expect(page.getByText('Allow usage access to see traffic')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Android data without the app state split hides that filter instead of showing zeros', async ({ page }) => {
  const { apps, ...rest } = demoSnapshot(7)
  const legacy: Record<string, unknown> = { ...rest, apps: apps.map(app => ({ ...app,
    days: app.days.map(({ date, wifi, mobile, wifiSent, mobileSent }) => ({ date, wifi, mobile, wifiSent, mobileSent })) })) }
  delete legacy.backgroundAvailable
  await mockNative(page, 'android', { payload: legacy })
  await page.goto('/')
  await expect(page.locator('.app-row')).toHaveCount(6)
  await expect(page.getByRole('group', { name: 'Traffic direction' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'App state' })).toHaveCount(0)
  await expect(page.locator('.insights')).toContainText('Received / sent')
  await expect(page.locator('.insights')).not.toContainText('Background share')
})

test('large Android inventories stay searchable and expandable', async ({ page }) => {
  const snapshot = demoSnapshot(7)
  const [template] = snapshot.apps
  const apps = Array.from({ length: 300 }, (_, index) => ({ ...template, id: `uid:${10_000 + index}`,
    name: `App ${String(index).padStart(3, '0')}`, packages: [`com.example.app${index}`] }))
  await mockNative(page, 'android', { payload: { ...snapshot, apps } })
  await page.goto('/')
  const rows = page.locator('.app-row')
  await expect(rows).toHaveCount(300)
  await expect(page.locator('.list-meta')).toContainText('300 app groups')
  await rows.last().click()
  await expect(page.getByRole('heading', { name: 'App 299 traffic' })).toBeVisible()
  await expect(page.locator('.app-detail')).toBeVisible()
  await page.getByLabel('Search apps').fill('app 29')
  await expect(rows).toHaveCount(10)
  await page.getByRole('button', { name: 'App permissions', exact: true }).click()
  await expect(rows).toHaveCount(10)
  await page.getByLabel('Search apps').fill('')
  await expect(rows).toHaveCount(300)
})

test('an unexpected crash offers a fresh start instead of a blank screen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Only the footer formats a time, so this makes the next dashboard render throw while `crash` is set.
  await page.addInitScript(() => {
    const target = window as unknown as { crash?: boolean }
    const format = Date.prototype.toLocaleTimeString
    Date.prototype.toLocaleTimeString = function (this: Date, ...args: Parameters<typeof format>) {
      if (target.crash) throw new Error('Simulated render failure')
      return format.apply(this, args)
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore demo' }).click()
  await expect(page.locator('.app-row')).toHaveCount(6)
  await page.evaluate(() => { (window as unknown as { crash: boolean }).crash = true })
  await page.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(page.getByRole('alert')).toContainText('Something went wrong')
  const reload = page.getByRole('button', { name: 'Reload dashboard' })
  await expect(reload).toBeFocused()
  await expect(page.locator('.app-row')).toHaveCount(0)
  await page.evaluate(() => { (window as unknown as { crash: boolean }).crash = false })
  await page.keyboard.press('Enter')
  await expect(page.getByText('Your browser cannot read device traffic')).toBeVisible()
  await page.getByRole('button', { name: 'Explore demo' }).click()
  await expect(page.locator('.app-row')).toHaveCount(6)
  expect(errors).toEqual([])
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
