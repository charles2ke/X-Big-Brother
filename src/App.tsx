import { useCallback, useEffect, useRef, useState } from 'react'
import { DeviceSettings, platform, TrafficMonitor } from './native'
import { aggregate, bytesLabel, dayKeys, demoSnapshot, filterApps, total } from './traffic'
import type { AppUsage, Network, Period, Snapshot } from './traffic'
import './App.css'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

function App() {
  const [page, setPage] = useState<'traffic' | 'permissions'>('traffic')
  const [period, setPeriod] = useState<Period>(7)
  const [network, setNetwork] = useState<Network>('all')
  const [demo, setDemo] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const loading = useRef(false)
  const cancelPending = useCallback(() => { request.current++ }, [])

  const refresh = useCallback(async () => {
    const current = ++request.current
    setError('')
    setSnapshot(null)
    loading.current = true
    setBusy(true)
    try {
      const data = demo ? demoSnapshot(period) : platform === 'android'
        ? await TrafficMonitor.getSnapshot({ days: period }) : null
      if (current === request.current) setSnapshot(data)
    } catch {
      if (current === request.current) setError('Unable to read device data. Check usage access in Settings, then retry.')
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

  const runSettings = async (action: () => Promise<void>) => {
    setError('')
    try { await action() } catch { setError('Could not open Settings. Please open your device Settings manually.') }
  }
  const apps = snapshot?.apps ?? []
  const dates = dayKeys(period, snapshot ? new Date(snapshot.generatedAt) : new Date())
  const activeApp = apps.find(app => app.id === selected)
  const chartDays = aggregate(activeApp ? [activeApp] : apps, dates)
  const allDays = aggregate(apps, dates)
  const unavailable = snapshot?.unavailableNetworks ?? []
  const hasUsage = snapshot?.accessGranted === true
  const networkUnavailable = network === 'all' ? unavailable.length > 0 : unavailable.includes(network)
  const usageLabel = (days: typeof allDays, kind: Network) =>
    !hasUsage ? '—' : (kind === 'all' ? unavailable.length > 0 : unavailable.includes(kind))
      ? 'Unavailable' : bytesLabel(total(days, kind))
  const max = Math.max(1, ...chartDays.map(day => total([day], network)))
  const filtered = filterApps(apps, search, network)
  const showShare = hasUsage && !networkUnavailable
  const topUsage = Math.max(1, ...filtered.map(app => total(app.days, network)))
  const granted = apps.reduce((sum, app) => sum + app.permissions.filter(p => p.granted).length, 0)

  const permissions = (app: AppUsage) => (
    <div className="permission-list">
      {app.permissions.length === 0 && <p className="muted">No requested permissions reported.</p>}
      {app.permissions.map(permission => <div className="permission" key={permission.id}>
        <div><strong>{permission.label}</strong><small>{permission.id}</small></div>
        <span className={permission.granted ? 'badge granted' : 'badge'}>{permission.granted ? 'Granted' : 'Not granted'}</span>
      </div>)}
      {app.packages.map(packageName => <button className="settings-button" key={packageName} disabled={demo}
        onClick={() => void runSettings(() => TrafficMonitor.openAppSettings({ packageName }))}>
        Manage permissions in Settings <span aria-hidden="true">↗</span>
        {app.packages.length > 1 && <small>{packageName}</small>}
      </button>)}
      {demo && <small className="muted">Settings are disabled for fictional demo apps.</small>}
    </div>
  )

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to dashboard</a>
      <aside className="sidebar">
        <a className="brand" href="#main"><span className="brand-icon" aria-hidden="true">X</span><span>BIG BROTHER<small>YOUR DATA. YOUR CONTROL.</small></span></a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Dashboard">
          <button className={page === 'traffic' ? 'nav active' : 'nav'} onClick={() => setPage('traffic')}><span aria-hidden="true">▥</span> Traffic overview</button>
          <button className={page === 'permissions' ? 'nav active' : 'nav'} onClick={() => setPage('permissions')}><span aria-hidden="true">◎</span> App permissions</button>
        </nav>
        <div className="privacy-card"><span className="privacy-dot" /> PRIVATE BY DESIGN<p>No accounts. No cloud.<br />Your traffic stays your business.</p><small>On-device statistics only</small></div>
        <div className="sidebar-footer">X BIG BROTHER <span>v0.1</span></div>
      </aside>

      <main id="main">
        <header className="topbar"><span>DEVICE INSIGHTS <span className="slash">/</span> {page === 'traffic' ? 'OVERVIEW' : 'PERMISSIONS'}</span><span className="status"><i /> {demo ? 'DEMO MODE' : platform === 'android' ? 'ON DEVICE' : platform === 'ios' ? 'iOS · LIMITED ACCESS' : 'BROWSER PREVIEW'}</span></header>
        <div className="content" aria-busy={busy}>
          <p className="visually-hidden" aria-live="polite">{busy ? 'Reading device data…' : snapshot ? `${demo ? 'Sample' : 'Device'} data updated. ${plural(filtered.length, 'app group')} listed.` : 'No device data available.'}</p>
          <div className="heading-row"><div><p className="eyebrow">A LITTLE VISIBILITY. A LOT MORE CONTROL.</p><h1>{page === 'traffic' ? 'Know where your data goes.' : 'Permissions, in plain sight.'}</h1><p className="subtitle">{page === 'traffic' ? 'Understand your network activity, one app at a time.' : 'Review what apps can access. You decide what stays on.'}</p></div>
            <button className="secondary refresh" disabled={busy} onClick={() => void refresh()}>{busy ? 'Reading…' : '↻ Refresh'}</button></div>

          {demo ? <section className="notice demo-notice" aria-label="Demo mode"><div><strong>Sample data · not your device traffic</strong><p>Explore the dashboard with fictional apps. No monitoring is taking place.</p></div><button className="secondary" onClick={() => { setDemo(false); setSelected(null) }}>Exit demo</button></section>
            : platform !== 'android' ? <section className="notice" aria-label="Platform limitations"><div><strong>{platform === 'ios' ? 'iOS protects other apps’ activity' : 'Your browser cannot read device traffic'}</strong><p>{platform === 'ios' ? 'iOS does not expose other apps’ Wi-Fi/mobile history or permission grants. Review cellular usage in Settings → Cellular, and permissions in Settings → Privacy & Security. This app cannot block traffic or revoke permissions.' : 'Install the Android app for OS-reported traffic and visible-app permissions. iOS offers privacy guidance, not device-wide monitoring.'}</p>
                {platform === 'ios' && <button className="settings-button" onClick={() => void runSettings(() => DeviceSettings.openAppSettings())}>Open this app’s Settings ↗</button>}</div><button className="primary" onClick={() => setDemo(true)}>Explore demo <span aria-hidden="true">→</span></button></section>
              : !hasUsage && !busy && <section className="notice"><div><strong>Allow usage access to see traffic</strong><p>Android requires your approval to read network statistics. Permission inventory is available separately. You can withdraw access at any time.</p></div><button className="primary" onClick={() => void runSettings(() => TrafficMonitor.openUsageSettings())}>Open usage settings ↗</button></section>}

          {error && <div className="error" role="alert"><span>{error}</span><button className="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Reading…' : 'Try again'}</button></div>}
          {!demo && snapshot && snapshot.warnings.length > 0 && <details className="coverage"><summary>Coverage & reporting limitations ({snapshot.warnings.length})</summary><ul>{snapshot.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
          {!demo && unavailable.length > 0 && <div className="error" role="status">{unavailable.join(' and ')} statistics are unavailable on this device. Totals that include them are not shown.</div>}

          <div className="section-controls"><div className="section-label"><span className="live-dot" /> {demo ? 'SAMPLE SNAPSHOT' : 'DEVICE SNAPSHOT'}<span className="muted"> · {period} days, UTC</span></div><div className="segmented" aria-label="Time range">{([7, 30] as const).map(days => <button key={days} disabled={busy} aria-pressed={period === days} className={period === days ? 'chosen' : ''} onClick={() => setPeriod(days)}>Last {days} days</button>)}</div></div>

          <section className="stats" aria-label="Usage summary">
            <article className="stat"><div className="stat-label">WI-FI TRAFFIC <span className="stat-icon wifi">◉</span></div><strong>{usageLabel(allDays, 'wifi')}</strong><small><span className="legend-dot wifi-bg" /> Received + sent</small></article>
            <article className="stat"><div className="stat-label">MOBILE TRAFFIC <span className="stat-icon mobile">▥</span></div><strong>{usageLabel(allDays, 'mobile')}</strong><small><span className="legend-dot mobile-bg" /> Received + sent</small></article>
            <article className="stat"><div className="stat-label">VISIBLE APP GROUPS <span className="stat-icon">▦</span></div><strong>{snapshot ? apps.length : '—'}</strong><small>Shared Android UIDs counted once</small></article>
            <article className="stat"><div className="stat-label">GRANTED PERMISSIONS <span className="stat-icon">◎</span></div><strong>{snapshot ? granted : '—'}</strong><small>Reported grants, not all special access</small></article>
          </section>

          {page === 'traffic' && <section className="panel trend-panel">
            <div className="panel-heading"><div><h2>{activeApp ? `${activeApp.name} traffic` : 'Traffic over time'}</h2><p>{activeApp ? 'Daily network usage for this app group' : 'Daily usage across visible app groups'} · UTC</p></div><div className="chart-legend"><span><i className="legend-dot wifi-bg" />Wi-Fi</span><span><i className="legend-dot mobile-bg" />Mobile</span></div></div>
            <div className="chart-meta"><strong>{usageLabel(chartDays, network)}</strong><span>{network === 'all' ? 'combined traffic' : `${network === 'wifi' ? 'Wi-Fi' : 'mobile'} traffic`}</span>{activeApp && <button className="text-button" onClick={() => setSelected(null)}>Show all apps</button>}</div>
            {!hasUsage || networkUnavailable ? <div className="empty-chart"><span aria-hidden="true">▥</span><strong>{busy ? 'Reading network statistics…' : networkUnavailable ? 'Network statistics unavailable' : 'Your traffic story starts here'}</strong><p>{networkUnavailable ? 'See coverage limitations above, or select an available network.' : 'No measurements to display. Grant Android usage access or explore demo data.'}</p></div>
              : <><div className="chart" role="img" aria-label={`Daily ${network} traffic for ${activeApp?.name ?? 'all visible apps'}. Exact values in the table below.`}>{chartDays.map(day => <div className="chart-column" key={day.date}>
                <div className="bar-track"><div className="bar-stack" style={{ height: `${total([day], network) / max * 100}%` }} title={`${day.date}: ${usageLabel([day], network)}`}>
                  {network !== 'wifi' && <div className="mobile-bg" style={{ flex: day.mobile }} />}
                  {network !== 'mobile' && <div className="wifi-bg" style={{ flex: day.wifi }} />}
                </div></div><span>{period === 7 || dates.indexOf(day.date) % 5 === 0 ? day.date.slice(5).replace('-', '/') : ''}</span>
              </div>)}</div><details className="data-table"><summary>View daily values</summary><div className="table-scroll"><table><caption>Daily received + sent bytes, UTC</caption><thead><tr><th>Date</th><th>Wi-Fi</th><th>Mobile</th></tr></thead><tbody>{chartDays.map(day => <tr key={day.date}><th>{day.date}</th><td>{usageLabel([day], 'wifi')}</td><td>{usageLabel([day], 'mobile')}</td></tr>)}</tbody></table></div></details></>}
          </section>}

          <section className="panel apps-panel">
            <div className="panel-heading"><div><h2>{page === 'traffic' ? 'App breakdown' : 'App permission inventory'}</h2><p>{page === 'traffic' ? 'Select an app to explore its trend and permissions.' : 'Granted means Android reports the permission flag, not necessarily unrestricted access.'}</p></div><label className="search"><span aria-hidden="true">⌕</span><input aria-label="Search apps" placeholder="Search apps…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="clear-search" aria-label="Clear search" onClick={() => setSearch('')}>×</button>}</label></div>
            <div className="app-filter"><div className="segmented" aria-label="Network filter">{(['all', 'wifi', 'mobile'] as const).map(kind => <button key={kind} aria-pressed={network === kind} className={network === kind ? 'chosen' : ''} onClick={() => setNetwork(kind)}>{kind === 'all' ? 'All networks' : kind === 'wifi' ? 'Wi-Fi' : 'Mobile'}</button>)}</div><small>{plural(filtered.length, 'app group')}{networkUnavailable ? ' · network unavailable' : ' · highest usage first'}</small></div>
            {filtered.length === 0 ? <div className="empty-apps"><strong>{search ? 'No matching apps' : 'No apps to show yet'}</strong><p>{search ? 'Try another name or package ID.' : busy ? 'Reading visible apps…' : 'Device data appears here when available. Demo data is always clearly labeled.'}</p></div> :
              <div className="app-list">{filtered.map((app, index) => <article className={`app-item ${selected === app.id ? 'selected' : ''}`} key={app.id}>
                <button className="app-row" aria-expanded={selected === app.id} onClick={() => setSelected(selected === app.id ? null : app.id)}>
                  <span className={`app-avatar avatar-${index % 6}`} aria-hidden="true">{app.name.slice(0, 1)}</span>
                  <span className="app-name"><strong>{app.name}</strong><small>{app.packages.join(' · ')}</small>{showShare && <span className="app-share" aria-hidden="true"><i style={{ width: `${total(app.days, network) / topUsage * 100}%` }} /></span>}</span>
                  <span className="app-value"><strong>{usageLabel(app.days, network)}</strong><small>{plural(app.permissions.filter(p => p.granted).length, 'grant')}</small></span><span className="chevron" aria-hidden="true">{selected === app.id ? '−' : '+'}</span>
                </button>
                {selected === app.id && <div className="app-detail">{app.packages.length > 1 && <p className="muted">Shared UID: traffic is combined; permission grants are grouped by permission name.</p>}{page === 'traffic' && <p className="muted">This app’s daily trend is shown in the chart above.</p>}{permissions(app)}</div>}
              </article>)}</div>}
          </section>
          <footer className="content-footer"><span>◈ Local only. No packet capture, VPN, analytics, or cloud sync.</span><span>{snapshot ? `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : 'Waiting for device data'}</span></footer>
          <p className="fine-print">Android statistics may be delayed or incomplete and exclude apps hidden by package visibility rules. They are not carrier billing records. Permissions can only be changed by you in system Settings; some grants cannot be revoked. iOS does not allow an ordinary app to inspect other apps’ traffic or permissions.</p>
        </div>
      </main>
    </div>
  )
}

export default App
