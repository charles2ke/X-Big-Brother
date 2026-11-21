import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { DeviceSettings, platform, TrafficMonitor } from './native'
import { allowedCategories, categorySummary, groupPermissions, permissionCategory } from './permissions'
import type { CategoryId } from './permissions'
import { parseSnapshot, SnapshotError } from './snapshot'
import { aggregate, bytesFor, bytesLabel, dailyAverage, dayBreakdown, dayKeys, dayTotal, demoSnapshot, filterApps, peakDay, total } from './traffic'
import type { Activity, AppUsage, DayUsage, Direction, Network, Period, Permission, Snapshot, SortOrder } from './traffic'
import './App.css'

type Page = 'traffic' | 'permissions'
/** Whether traffic can be shown: no usage access, the chosen network unavailable, or measured. */
type Measured = 'none' | 'unavailable' | 'measured'

const noApps: AppUsage[] = []
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const percent = (part: number, whole: number) =>
  whole <= 0 ? '0%' : part > 0 && part / whole < 0.01 ? '<1%' : `${Math.round(part / whole * 100)}%`
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const utcDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...options })
const shortDate = (date: string) => utcDate(date, { month: 'short', day: 'numeric' })
const longDate = (date: string) => utcDate(date, { weekday: 'short', month: 'short', day: 'numeric' })
const directions: [Direction, string][] = [['both', 'Received + sent'], ['received', 'Received'], ['sent', 'Sent']]
const activities: [Activity, string][] = [['all', 'All app states'], ['foreground', 'Foreground'], ['background', 'Background']]
const sortOptions: Record<Page, [SortOrder, string][]> = {
  traffic: [['usage', 'Highest usage'], ['name', 'Name (A–Z)']],
  permissions: [['sensitive', 'Most sensitive access'], ['name', 'Name (A–Z)']],
}

// Busy and malformed reads are not access problems, so they offer a retry without the usage access prompt.
function readError(error: unknown): { message: string; accessHint: boolean } {
  if (error instanceof SnapshotError) {
    return { message: 'Device data arrived in an unexpected format, so none of it is shown. Try again.', accessHint: false }
  }
  if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'BUSY') {
    return { message: 'Android is still reading the previous snapshot. Try again in a moment.', accessHint: false }
  }
  return { message: 'Unable to read device data. Check usage access in Settings, then retry.', accessHint: true }
}

// Arrows are decorative; compact splits keep the words for screen readers only.
function split(days: DayUsage[], kind: Network, compact = false) {
  const word = (text: string) => <span className={compact ? 'visually-hidden' : undefined}> {text}</span>
  return <span className="split">
    <span aria-hidden="true">↓</span> {bytesLabel(total(days, kind, 'received'))}{word('received')}
    <span aria-hidden="true">{compact ? ' ' : ' · '}</span>
    <span aria-hidden="true">↑</span> {bytesLabel(total(days, kind, 'sent'))}{word('sent')}
  </span>
}

function permissionRow(permission: Permission) {
  const group = permissionCategory(permission.id)
  return <div className="permission" key={permission.id}>
    <div><strong>{permission.label}</strong><small>{permission.id}</small></div>
    <span className="badges">
      {group && group.label !== permission.label && <span className="badge category">{group.label}</span>}
      <span className={permission.granted ? 'badge granted' : 'badge'}>{permission.granted ? 'Granted' : 'Not granted'}</span>
    </span>
  </div>
}

function PermissionList({ app, demo, onOpenSettings }: { app: AppUsage; demo: boolean; onOpenSettings: (packageName: string) => void }) {
  const { sensitive, other } = groupPermissions(app.permissions)
  return <div className="permission-list">
    {app.permissions.length === 0 ? <p className="muted">No requested permissions reported.</p>
      : sensitive.length === 0 && <p className="muted">No sensitive runtime permissions requested.</p>}
    {sensitive.map(permissionRow)}
    {other.length > 0 && <details className="other-permissions"><summary>Other permissions ({other.length})</summary>{other.map(permissionRow)}</details>}
    {app.packages.map(packageName => <button className="settings-button" key={packageName} disabled={demo}
      onClick={() => onOpenSettings(packageName)}>
      Manage permissions in Settings <span aria-hidden="true">↗</span>
      {app.packages.length > 1 && <small>{packageName}</small>}
    </button>)}
    {demo && <small className="muted">Settings are disabled for fictional demo apps.</small>}
  </div>
}

interface AppRowProps {
  app: AppUsage
  avatar: number
  expanded: boolean
  onToggle: (id: string) => void
  onTraffic: boolean
  network: Network
  direction: Direction
  activity: Activity
  measured: Measured
  /** Usage of the busiest listed app, the full width of a share bar. */
  topUsage: number
  /** The sensitive-access category the permission list is filtered by. */
  highlight: CategoryId | null
  demo: boolean
  onOpenSettings: (packageName: string) => void
}

// Rows take only primitive or stable props, so a filter, day or row change re-renders just the rows it affects.
const AppRow = memo(function AppRow({ app, avatar, expanded, onToggle, onTraffic, network, direction, activity, measured,
  topUsage, highlight, demo, onOpenSettings }: AppRowProps) {
  const grants = app.permissions.filter(permission => permission.granted).length
  const usage = onTraffic && measured === 'measured' ? total(app.days, network, direction, activity) : 0
  const allowed = onTraffic ? [] : allowedCategories(app)
  return <article className={`app-item ${expanded ? 'selected' : ''}`}>
    <button className="app-row" aria-expanded={expanded} onClick={() => onToggle(app.id)}>
      <span className={`app-avatar avatar-${avatar % 6}`} aria-hidden="true">{app.name.slice(0, 1)}</span>
      <span className="app-name"><strong>{app.name}</strong><small>{app.packages.join(' · ')}</small>
        {onTraffic ? measured === 'measured' && <span className="app-share" aria-hidden="true"><i style={{ width: `${usage / topUsage * 100}%` }} /></span>
          : <span className="chips">{allowed.length === 0 ? <span className="chip quiet">No sensitive access</span>
            : allowed.map(entry => <span className={entry.id === highlight ? 'chip active' : 'chip'} key={entry.id}>{entry.label}</span>)}</span>}
      </span>
      {onTraffic ? <span className="app-value"><strong>{measured === 'none' ? '—' : measured === 'unavailable' ? 'Unavailable' : bytesLabel(usage)}</strong>
        <small>{measured !== 'measured' ? plural(grants, 'grant') : direction === 'both' && activity === 'all' ? split(app.days, network, true)
          : `${percent(usage, total(app.days, network))} of its traffic`}</small></span>
        : <span className="app-value"><strong>{plural(grants, 'grant')}</strong><small>of {app.permissions.length} requested</small></span>}
      <span className="chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="app-detail">{app.packages.length > 1 && <p className="muted">Shared UID: traffic is combined; permission grants are grouped by permission name.</p>}{onTraffic && <p className="muted">This app’s daily trend is shown in the chart above.</p>}<PermissionList app={app} demo={demo} onOpenSettings={onOpenSettings} /></div>}
  </article>
})

function App() {
  const [page, setPage] = useState<Page>('traffic')
  const [period, setPeriod] = useState<Period>(7)
  const [network, setNetwork] = useState<Network>('all')
  const [direction, setDirection] = useState<Direction>('both')
  const [chosenActivity, setActivity] = useState<Activity>('all')
  const [sorts, setSorts] = useState<Record<Page, SortOrder>>({ traffic: 'usage', permissions: 'sensitive' })
  const [category, setCategory] = useState<CategoryId | null>(null)
  const [demo, setDemo] = useState(false)
  // The latest read and its source. Refreshing the same source keeps it visible until the new read lands.
  const [loaded, setLoaded] = useState<{ snapshot: Snapshot | null; demo: boolean; period: Period } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [focusedDay, setFocusedDay] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  // Kept here because the chart panel remounts while a new time range loads.
  const [tableOpen, setTableOpen] = useState(false)
  const [error, setError] = useState<{ message: string; retry: () => void; accessHint?: boolean } | null>(null)
  const request = useRef(0)
  const loading = useRef(false)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const chart = useRef<HTMLDivElement>(null)
  const listCount = useRef<HTMLElement>(null)
  const cancelPending = useCallback(() => { request.current++ }, [])

  const refresh = useCallback(async function refresh() {
    const current = ++request.current
    setError(null)
    loading.current = true
    setBusy(true)
    try {
      const data = demo ? demoSnapshot(period) : platform === 'android'
        ? parseSnapshot(await TrafficMonitor.getSnapshot({ days: period })) : null
      if (current === request.current) setLoaded({ snapshot: data, demo, period })
    } catch (failure) {
      if (current === request.current) {
        if (failure instanceof SnapshotError) console.error(failure)
        setLoaded(null)
        setError({ ...readError(failure), retry: () => void refresh() })
      }
    } finally {
      if (current === request.current) {
        loading.current = false
        setBusy(false)
      }
    }
  }, [demo, period])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void refresh() })
    const onReturn = () => { if (document.visibilityState === 'visible' && !loading.current) void refresh() }
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      cancelled = true
      cancelPending()
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh, cancelPending])

  const runSettings = useCallback(async function runSettings(action: () => Promise<void>) {
    setError(null)
    try { await action() } catch { setError({ message: 'Could not open Settings. Please open your device Settings manually.', retry: () => void runSettings(action) }) }
  }, [])
  const openAppSettings = useCallback((packageName: string) =>
    void runSettings(() => TrafficMonitor.openAppSettings({ packageName })), [runSettings])
  const toggleApp = useCallback((id: string) => setSelected(current => current === id ? null : id), [])
  // Busy controls use aria-disabled rather than disabled, so they keep keyboard focus while Android reads.
  const reread = () => { if (!loading.current) void refresh() }
  const choosePeriod = (days: Period) => { if (!loading.current) setPeriod(days) }
  // The sidebar stays in view while scrolling, so a newly chosen page starts at its top.
  const choosePage = (next: Page) => {
    if (next !== page) window.scrollTo(0, 0)
    setPage(next)
  }

  // A read for another source or time range is never shown as the current one. Until it settles, the
  // dashboard reads as loading, not as empty, so an access notice cannot flash before the read starts.
  const settled = loaded !== null && loaded.demo === demo && loaded.period === period
  const snapshot = settled ? loaded.snapshot : null
  const reading = busy || (!settled && !error && (demo || platform === 'android'))
  const onTraffic = page === 'traffic'
  const apps = snapshot?.apps ?? noApps
  const generatedAt = snapshot?.generatedAt
  const dates = useMemo(() => dayKeys(period, generatedAt ? new Date(generatedAt) : new Date()), [period, generatedAt])
  const activeApp = useMemo(() => apps.find(app => app.id === selected), [apps, selected])
  const allDays = useMemo(() => aggregate(apps, dates), [apps, dates])
  const chartDays = useMemo(() => activeApp ? aggregate([activeApp], dates) : allDays, [activeApp, allDays, dates])
  const unavailable = snapshot?.unavailableNetworks ?? []
  const hasUsage = snapshot?.accessGranted === true
  const isUnavailable = (kind: Network) => kind === 'all' ? unavailable.length > 0 : unavailable.includes(kind)
  const networkUnavailable = isUnavailable(network)
  const showShare = hasUsage && !networkUnavailable
  const measured: Measured = !hasUsage ? 'none' : networkUnavailable ? 'unavailable' : 'measured'
  // Without Android's foreground/background split the filter is hidden rather than showing zeros.
  const splitHidden = snapshot?.backgroundAvailable === false
  const activity: Activity = splitHidden ? 'all' : chosenActivity
  const usageLabel = (days: DayUsage[], kind: Network, flow: Direction = 'both', state: Activity = 'all') =>
    !hasUsage ? '—' : isUnavailable(kind) ? 'Unavailable' : bytesLabel(total(days, kind, flow, state))
  const scope = `${network === 'all' ? 'combined' : network === 'wifi' ? 'Wi-Fi' : 'mobile'}${activity === 'all' ? '' : ` ${activity}`} traffic${direction === 'both' ? '' : ` ${direction}`}`
  const dayBytes = useMemo(() => chartDays.map(day => dayTotal(day, network, direction, activity)), [chartDays, network, direction, activity])
  const max = Math.max(1, ...dayBytes)
  const summary = useMemo(() => categorySummary(apps), [apps])
  const activeCategory = onTraffic ? null : summary.find(entry => entry.category.id === category)?.category ?? null
  const activeCategoryId = activeCategory?.id ?? null
  const sort = sorts[page]
  // Typing stays responsive on large inventories; the list catches up in a lower-priority render.
  const deferredSearch = useDeferredValue(search)
  const filtered = useMemo(() => onTraffic ? filterApps(apps, deferredSearch, network, { direction, activity, sort })
    : filterApps(apps, deferredSearch, 'all', { sort, category: activeCategoryId, matchPermissions: true }),
  [onTraffic, apps, deferredSearch, network, direction, activity, sort, activeCategoryId])
  const topUsage = useMemo(() => onTraffic
    ? filtered.reduce((most, app) => Math.max(most, total(app.days, network, direction, activity)), 1) : 1,
  [onTraffic, filtered, network, direction, activity])
  // Color avatars by snapshot order so an app keeps its color across pages, sorts, and filters.
  const avatars = useMemo(() => new Map(apps.map((app, index) => [app.id, index])), [apps])
  const sensitiveApps = useMemo(() => apps.filter(app => allowedCategories(app).length > 0).length, [apps])
  const peak = peakDay(chartDays, network, direction, activity)
  const shown = total(chartDays, network, direction, activity)
  const everything = total(chartDays, network)
  const activeDay = onTraffic && showShare && selectedDay && dates.includes(selectedDay) ? selectedDay : null
  const tabDay = [focusedDay, activeDay].find(date => date && dates.includes(date)) ?? dates.at(-1)
  const breakdown = useMemo(() => activeDay ? dayBreakdown(apps, activeDay, network, direction, activity) : [],
    [apps, activeDay, network, direction, activity])
  const breakdownTotal = breakdown.reduce((sum, entry) => sum + entry.bytes, 0)

  const moveChartFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const columns = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.chart-column'))
    const current = columns.indexOf(document.activeElement as HTMLButtonElement)
    const target = ({ ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: columns.length - 1 } as
      Record<string, number | undefined>)[event.key]
    if (current < 0 || target === undefined) return
    event.preventDefault()
    columns[Math.max(0, Math.min(columns.length - 1, target))].focus()
  }
  const closeDay = () => {
    chart.current?.querySelector<HTMLButtonElement>('.chart-column[aria-pressed="true"]')?.focus()
    setSelectedDay(null)
  }
  // The button disappears once cleared, so keep focus on the neighboring list count.
  const clearCategory = () => {
    listCount.current?.focus()
    setCategory(null)
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to dashboard</a>
      <aside className="sidebar">
        <a className="brand" href="#main"><span className="brand-icon" aria-hidden="true">X</span><span>BIG BROTHER<small>YOUR DATA. YOUR CONTROL.</small></span></a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Dashboard">
          <button className={page === 'traffic' ? 'nav active' : 'nav'} aria-current={page === 'traffic' ? 'page' : undefined} onClick={() => choosePage('traffic')}><span aria-hidden="true">▥</span> Traffic overview</button>
          <button className={page === 'permissions' ? 'nav active' : 'nav'} aria-current={page === 'permissions' ? 'page' : undefined} onClick={() => choosePage('permissions')}><span aria-hidden="true">◎</span> App permissions</button>
        </nav>
        <div className="privacy-card"><span className="privacy-dot" /> PRIVATE BY DESIGN<p>No accounts. No cloud.<br />Your traffic stays your business.</p><small>On-device statistics only</small></div>
        <div className="sidebar-footer">X BIG BROTHER <span>v0.1</span></div>
      </aside>

      <main id="main" tabIndex={-1}>
        <header className="topbar"><span>DEVICE INSIGHTS <span className="slash">/</span> {page === 'traffic' ? 'OVERVIEW' : 'PERMISSIONS'}</span><span className="status"><i /> {demo ? 'DEMO MODE' : platform === 'android' ? 'ON DEVICE' : platform === 'ios' ? 'iOS · LIMITED ACCESS' : 'BROWSER PREVIEW'}</span></header>
        <div className="content" aria-busy={reading}>
          <p className="visually-hidden" aria-live="polite">{reading ? 'Reading device data…' : snapshot ? `${demo ? 'Sample' : 'Device'} data updated. ${plural(filtered.length, 'app group')} listed.${activeDay ? ` Showing top apps for ${longDate(activeDay)}.` : ''}` : 'No device data available.'}</p>
          <div className="heading-row"><div><p className="eyebrow">A LITTLE VISIBILITY. A LOT MORE CONTROL.</p><h1>{page === 'traffic' ? 'Know where your data goes.' : 'Permissions, in plain sight.'}</h1><p className="subtitle">{page === 'traffic' ? 'Understand your network activity, one app at a time.' : 'Review what apps can access. You decide what stays on.'}</p></div>
            <button ref={refreshButton} className="secondary refresh" aria-disabled={reading} onClick={reread}>{reading ? 'Reading…' : '↻ Refresh'}</button></div>

          {demo ? <section className="notice demo-notice" aria-label="Demo mode"><div><strong>Sample data · not your device traffic</strong><p>Explore the dashboard with fictional apps. No monitoring is taking place.</p></div><button className="secondary" onClick={() => { setDemo(false); setSelected(null); setSelectedDay(null); setCategory(null) }}>Exit demo</button></section>
            : platform !== 'android' ? <section className="notice" aria-label="Platform limitations"><div><strong>{platform === 'ios' ? 'iOS protects other apps’ activity' : 'Your browser cannot read device traffic'}</strong><p>{platform === 'ios' ? 'iOS does not expose other apps’ Wi-Fi/mobile history or permission grants. Review cellular usage in Settings → Cellular, and permissions in Settings → Privacy & Security. This app cannot block traffic or revoke permissions.' : 'Install the Android app for OS-reported traffic and visible-app permissions. iOS offers privacy guidance, not device-wide monitoring.'}</p>
                {platform === 'ios' && <button className="settings-button" onClick={() => void runSettings(() => DeviceSettings.openAppSettings())}>Open this app’s Settings ↗</button>}</div><button className="primary" onClick={() => setDemo(true)}>Explore demo <span aria-hidden="true">→</span></button></section>
              : !hasUsage && (!reading || snapshot !== null) && error?.accessHint !== false && <section className="notice"><div><strong>Allow usage access to see traffic</strong><p>Android requires your approval to read network statistics. Permission inventory is available separately. You can withdraw access at any time.</p></div><button className="primary" onClick={() => void runSettings(() => TrafficMonitor.openUsageSettings())}>Open usage settings ↗</button></section>}

          {/* Retrying removes this alert, so focus moves to Refresh, which reports the read in progress. */}
          {error && <div className="error" role="alert"><span>{error.message}</span><button className="secondary" disabled={reading} onClick={() => { refreshButton.current?.focus(); error.retry() }}>{reading ? 'Reading…' : 'Try again'}</button></div>}
          {!demo && snapshot && snapshot.warnings.length > 0 && <details className="coverage"><summary>Coverage & reporting limitations ({snapshot.warnings.length})</summary><ul>{snapshot.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
          {!demo && unavailable.length > 0 && <div className="error" role="status">{unavailable.join(' and ')} statistics are unavailable on this device. Totals that include them are not shown.</div>}

          <div className="section-controls"><div className="section-label"><span className="live-dot" /> {demo ? 'SAMPLE SNAPSHOT' : 'DEVICE SNAPSHOT'}<span className="muted"> · {period} days, UTC</span></div><div className="segmented" role="group" aria-label="Time range">{([7, 30] as const).map(days => <button key={days} aria-disabled={reading} aria-pressed={period === days} className={period === days ? 'chosen' : ''} onClick={() => choosePeriod(days)}>Last {days} days</button>)}</div></div>

          <section className="stats" aria-label="Usage summary">
            <article className="stat"><div className="stat-label">WI-FI TRAFFIC <span className="stat-icon wifi">◉</span></div><strong>{usageLabel(allDays, 'wifi')}</strong><small><span className="legend-dot wifi-bg" /> {hasUsage && !isUnavailable('wifi') ? split(allDays, 'wifi') : 'Received + sent'}</small></article>
            <article className="stat"><div className="stat-label">MOBILE TRAFFIC <span className="stat-icon mobile">▥</span></div><strong>{usageLabel(allDays, 'mobile')}</strong><small><span className="legend-dot mobile-bg" /> {hasUsage && !isUnavailable('mobile') ? split(allDays, 'mobile') : 'Received + sent'}</small></article>
            <article className="stat"><div className="stat-label">VISIBLE APP GROUPS <span className="stat-icon">▦</span></div><strong>{snapshot ? apps.length : '—'}</strong><small>Shared Android UIDs counted once</small></article>
            <article className="stat"><div className="stat-label">SENSITIVE ACCESS <span className="stat-icon">◎</span></div><strong>{snapshot ? sensitiveApps : '—'}</strong><small>App groups granted a runtime permission such as camera or location</small></article>
          </section>

          {onTraffic && <section className="panel trend-panel">
            <div className="panel-heading"><div><h2>{activeApp ? `${activeApp.name} traffic` : 'Traffic over time'}</h2><p>{activeApp ? 'Daily network usage for this app group' : 'Daily usage across visible app groups'} · UTC · choose a day for its top apps</p></div><div className="chart-legend"><span><i className="legend-dot wifi-bg" />Wi-Fi</span><span><i className="legend-dot mobile-bg" />Mobile</span></div></div>
            <div className="chart-meta"><strong>{usageLabel(chartDays, network, direction, activity)}</strong><span>{scope}</span>{activeApp && <button className="text-button" onClick={() => setSelected(null)}>Show all apps</button>}
              {activity !== 'all' && <p className="state-note">Android decides the split: foreground covers apps on screen or running a foreground service, such as music or navigation. Everything else is background.</p>}</div>
            {!showShare ? <div className="empty-chart"><span aria-hidden="true">▥</span><strong>{reading ? 'Reading network statistics…' : networkUnavailable ? 'Network statistics unavailable' : 'Your traffic story starts here'}</strong><p>{networkUnavailable ? 'See coverage limitations above, or select an available network.' : 'No measurements to display. Grant Android usage access or explore demo data.'}</p></div>
              : <>
                <dl className="insights">
                  <div><dt>Daily average</dt><dd>{bytesLabel(dailyAverage(chartDays, network, direction, activity))}<small>over {period} days, today partial</small></dd></div>
                  <div><dt>Peak day</dt><dd>{peak ? <>{bytesLabel(dayTotal(peak, network, direction, activity))}<small>on {longDate(peak.date)}</small></> : 'No traffic recorded'}</dd></div>
                  {direction === 'both' && activity === 'all'
                    ? <div><dt>Received / sent</dt><dd>{split(chartDays, network, true)}</dd></div>
                    : <div><dt>{capitalize(`${activity === 'all' ? '' : `${activity} `}${direction === 'both' ? '' : direction}`.trim())} share</dt><dd>{percent(shown, everything)}<small>of {bytesLabel(everything)}{direction === 'both' ? '' : ' received + sent'}{activity === 'all' ? '' : ' in all app states'}</small></dd></div>}
                  {activity === 'all' && !splitHidden && <div><dt>Background share</dt><dd>{percent(total(chartDays, network, direction, 'background'), shown)}<small>of {bytesLabel(shown)} {direction === 'both' ? 'received + sent' : direction}</small></dd></div>}
                </dl>
                <div ref={chart} className={activeDay ? 'chart has-selection' : 'chart'} role="toolbar" onKeyDown={moveChartFocus}
                  aria-label={`Daily ${scope} for ${activeApp?.name ?? 'all visible apps'}. Choose a day to see its top apps.`}>
                  {chartDays.map((day, index) => <button type="button" className="chart-column" key={day.date}
                    aria-pressed={activeDay === day.date} tabIndex={day.date === tabDay ? 0 : -1}
                    aria-label={`${longDate(day.date)}: ${bytesLabel(dayBytes[index])}`}
                    onFocus={() => setFocusedDay(day.date)} onClick={() => setSelectedDay(activeDay === day.date ? null : day.date)}>
                    <span className="bar-track"><span className="bar-stack" style={{ height: `${dayBytes[index] / max * 100}%` }} title={`${day.date}: ${bytesLabel(dayBytes[index])}`}>
                      {network !== 'wifi' && <span className="mobile-bg" style={{ flex: bytesFor(day, 'mobile', direction, activity) }} />}
                      {network !== 'mobile' && <span className="wifi-bg" style={{ flex: bytesFor(day, 'wifi', direction, activity) }} />}
                    </span></span><span className="chart-date" aria-hidden="true">{period === 7 || index % 5 === 0 ? shortDate(day.date) : ''}</span>
                  </button>)}
                </div>
                {activeDay && <section className="day-details" id="day-details" aria-labelledby="day-details-title">
                  <div className="day-details-heading"><h3 id="day-details-title">Top apps · {longDate(activeDay)} <span className="muted">UTC</span></h3><button className="text-button" onClick={closeDay}>Close day</button></div>
                  {breakdown.length === 0 ? <p className="muted">No {scope} recorded on this day.</p> : <>
                    <p className="muted">{bytesLabel(breakdownTotal)} {scope} across visible app groups</p>
                    <ol className="day-apps">{breakdown.slice(0, 5).map(({ app, bytes }) => <li key={app.id} className={app.id === selected ? 'current' : undefined}>
                      <span className="day-app-name">{app.name}</span>
                      <span className="day-app-value">{bytesLabel(bytes)} <small>{percent(bytes, breakdownTotal)}</small></span>
                      <span className="day-app-bar" aria-hidden="true"><i style={{ width: `${bytes / breakdownTotal * 100}%` }} /></span>
                    </li>)}</ol>
                    {breakdown.length > 5 && <p className="muted">+{plural(breakdown.length - 5, 'more app group')}</p>}
                  </>}
                </section>}
                <details className="data-table" open={tableOpen} onToggle={event => setTableOpen(event.currentTarget.open)}><summary>View daily values</summary><div className="table-scroll"><table><caption>Daily {activity === 'all' ? '' : `${activity} `}{direction === 'both' ? 'received + sent' : direction} bytes, UTC</caption><thead><tr><th>Date</th><th>Wi-Fi</th><th>Mobile</th></tr></thead><tbody>{chartDays.map(day => <tr key={day.date}><th>{day.date}</th><td>{usageLabel([day], 'wifi', direction, activity)}</td><td>{usageLabel([day], 'mobile', direction, activity)}</td></tr>)}</tbody></table></div></details>
              </>}
          </section>}

          {!onTraffic && snapshot && <section className="panel access-panel" aria-labelledby="access-title">
            <div className="panel-heading"><div><h2 id="access-title">Sensitive access</h2><p>Runtime permissions Android asks you to approve, grouped as in Android’s permission manager. Choose one to list the app groups granted it. Special access, such as accessibility or usage access, is not included.</p></div></div>
            {summary.length === 0 ? <p className="empty-access">No visible app group is granted a sensitive runtime permission.</p>
              : <div className="access-grid">{summary.map(({ category: entry, apps: count }) => <button key={entry.id} className="access-tile"
                aria-pressed={activeCategory?.id === entry.id} onClick={() => setCategory(activeCategory?.id === entry.id ? null : entry.id)}>
                <strong>{entry.label}</strong><small>{count} of {plural(apps.length, 'app group')}</small>
              </button>)}</div>}
          </section>}

          <section className="panel apps-panel">
            <div className="panel-heading"><div><h2>{onTraffic ? 'App breakdown' : 'App permission inventory'}</h2><p>{onTraffic ? 'Select an app to explore its trend and permissions.' : 'Granted means Android reports the permission flag, not necessarily unrestricted access.'}</p></div><label className="search"><span aria-hidden="true">⌕</span><input aria-label="Search apps" placeholder={onTraffic ? 'Search apps…' : 'Search apps or permissions…'} value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="clear-search" aria-label="Clear search" onClick={() => setSearch('')}>×</button>}</label></div>
            <div className="app-filter">
              <div className="filters">
                {onTraffic && <>
                  <div className="segmented" role="group" aria-label="Network filter">{(['all', 'wifi', 'mobile'] as const).map(kind => <button key={kind} aria-pressed={network === kind} className={network === kind ? 'chosen' : ''} onClick={() => setNetwork(kind)}>{kind === 'all' ? 'All networks' : kind === 'wifi' ? 'Wi-Fi' : 'Mobile'}</button>)}</div>
                  <div className="segmented" role="group" aria-label="Traffic direction">{directions.map(([flow, label]) => <button key={flow} aria-pressed={direction === flow} className={direction === flow ? 'chosen' : ''} onClick={() => setDirection(flow)}>{label}</button>)}</div>
                  {!splitHidden && <div className="segmented" role="group" aria-label="App state">{activities.map(([state, label]) => <button key={state} aria-pressed={activity === state} className={activity === state ? 'chosen' : ''} onClick={() => setActivity(state)}>{label}</button>)}</div>}
                </>}
                <label className="sort"><span aria-hidden="true">Sort</span><select aria-label="Sort apps" value={sort} onChange={event => setSorts({ ...sorts, [page]: event.target.value as SortOrder })}>{sortOptions[page].map(([order, label]) => <option key={order} value={order}>{label}</option>)}</select></label>
              </div>
              <span className="list-meta"><small ref={listCount} tabIndex={-1}>{plural(filtered.length, 'app group')}{activeCategory ? ` with ${activeCategory.label} access` : ''}{onTraffic && networkUnavailable ? ' · network unavailable' : ''}</small>{activeCategory && <button className="text-button" onClick={clearCategory}>Clear filter</button>}</span>
            </div>
            {filtered.length === 0 ? <div className="empty-apps"><strong>{deferredSearch ? 'No matching apps' : 'No apps to show yet'}</strong><p>{deferredSearch ? onTraffic ? 'Try another name or package ID.' : `Try another app name, package ID, or permission${activeCategory ? ', or clear the filter' : ''}.` : reading ? 'Reading visible apps…' : 'Device data appears here when available. Demo data is always clearly labeled.'}</p></div> :
              <div className="app-list">{filtered.map(app => <AppRow key={app.id} app={app} avatar={avatars.get(app.id) ?? 0}
                expanded={selected === app.id} onToggle={toggleApp} onTraffic={onTraffic} network={network} direction={direction}
                activity={activity} measured={measured} topUsage={topUsage} highlight={activeCategoryId} demo={demo} onOpenSettings={openAppSettings} />)}</div>}
          </section>
          <footer className="content-footer"><span>◈ Local only. No packet capture, VPN, analytics, or cloud sync.</span><span>{snapshot ? `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : 'Waiting for device data'}</span></footer>
          <p className="fine-print">Android statistics may be delayed or incomplete and exclude apps hidden by package visibility rules. They are not carrier billing records. Permissions can only be changed by you in system Settings; some grants cannot be revoked. iOS does not allow an ordinary app to inspect other apps’ traffic or permissions.</p>
        </div>
      </main>
    </div>
  )
}

export default App
