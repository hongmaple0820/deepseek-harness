/** Export and import of this profile's portable user-data bundle. */
import { useRef, useState } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BACKUP_COMPONENTS,
  DEFAULT_COMPONENTS,
  applyBundle,
  exportUrl,
  fetchRemoteBundle,
  previewBundle,
  pushBundle,
  remoteBundles,
  remoteList,
  type BackupComponent,
  type PushReceipt,
  type RemoteListing,
  type RestorePlan,
} from './transfer.ts'
import css from './UserDataSection.module.css'

/** Browser action the section asks for, supplied by the plugin. */
export interface UserDataInjected {
  /**
   * Hand a Host download route to the browser download manager.
   * @param url - document-relative route.
   */
  download: (url: string) => void
}

type Face = InjectFace<UserDataInjected> & PropsLocale<'settings.userData'>

const COMPONENT_COPY = {
  profile: 'componentProfile',
  settings: 'componentSettings',
  sessions: 'componentSessions',
  credentials: 'componentCredentials',
} as const satisfies Record<BackupComponent, string>

type Failure = 'import' | 'sync'

/**
 * Render the export selection, the import pipeline and their outcomes.
 * @param props - download action and localized copy.
 * @returns the User data settings section.
 */
export function UserDataSection({ download, t }: Face) {
  const picker = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<readonly BackupComponent[]>(DEFAULT_COMPONENTS)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [pending, setPending] = useState<{ plan: RestorePlan; bytes: Uint8Array } | null>(null)
  const [applied, setApplied] = useState<RestorePlan | null>(null)
  const [remotes, setRemotes] = useState<readonly RemoteListing[] | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState<PushReceipt | null>(null)

  const toggle = (component: BackupComponent, enabled: boolean): void => {
    setSelected(current => enabled
      ? BACKUP_COMPONENTS.filter(candidate => candidate === component || current.includes(candidate))
      : current.filter(candidate => candidate !== component))
  }

  const choose = async (file: File | undefined): Promise<void> => {
    /* v8 ignore next -- the file input reports an empty list only through its cancel path, which no change event carries. */
    if (file === undefined) return
    setBusy('preview')
    setFailure(null)
    setApplied(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setPending({ plan: await previewBundle(bytes), bytes })
    } catch {
      setPending(null)
      setFailure('import')
    } finally {
      setBusy(null)
    }
  }

  const apply = async (): Promise<void> => {
    /* v8 ignore next -- the apply control renders only while a preview is pending. */
    if (pending === null) return
    setBusy('apply')
    setFailure(null)
    try {
      setApplied(await applyBundle(pending.bytes))
      setPending(null)
    } catch {
      setFailure('import')
    } finally {
      setBusy(null)
    }
  }

  const reload = async (): Promise<readonly RemoteListing[]> => {
    const listings = await Promise.all((await remoteList()).map(async remote => ({
      ...remote,
      entries: await remoteBundles(remote.id),
    })))
    setRemotes(listings)
    return listings
  }

  const refresh = async (): Promise<void> => {
    setSyncing(true)
    setFailure(null)
    setSynced(null)
    try {
      await reload()
    } catch {
      setRemotes(null)
      setFailure('sync')
    } finally {
      setSyncing(false)
    }
  }

  const push = async (id: string): Promise<void> => {
    setSyncing(true)
    setFailure(null)
    try {
      setSynced(await pushBundle(id, selected))
      await reload()
    } catch {
      setFailure('sync')
    } finally {
      setSyncing(false)
    }
  }

  const restore = async (id: string, name: string): Promise<void> => {
    setSyncing(true)
    setFailure(null)
    setApplied(null)
    try {
      const bytes = await fetchRemoteBundle(id, name)
      setPending({ plan: await previewBundle(bytes), bytes })
    } catch {
      setPending(null)
      setFailure('sync')
    } finally {
      setSyncing(false)
    }
  }

  return <section className={css.section}>
    <header>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
    </header>

    <div className={css.group}>
      <h3 className={css.heading}>{t('exportHeading')}</h3>
      <p className={css.hint}>{t('exportHint')}</p>
      <div className={css.checks}>
        {BACKUP_COMPONENTS.map(component => <Checkbox key={component}
          checked={selected.includes(component)}
          label={t(COMPONENT_COPY[component])}
          onChange={(enabled) => { toggle(component, enabled) }} />)}
      </div>
      <Button variant="outline" size="sm" disabled={selected.length === 0}
        onClick={() => {
          setFailure(null)
          download(exportUrl(selected))
        }}>{t('exportAction')}</Button>
    </div>

    <div className={css.group}>
      <h3 className={css.heading}>{t('importHeading')}</h3>
      <p className={css.hint}>{t('importHint')}</p>
      <Button variant="outline" size="sm" disabled={busy !== null}
        onClick={() => {
          /* v8 ignore next -- React attaches the ref before any click can reach this control. */
          picker.current?.click()
        }}>{t('importAction')}</Button>
      <input ref={picker} className={css.picker} type="file" accept=".zip,application/zip"
        aria-label={t('importAction')} onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void choose(file)
        }} />
      {pending !== null && <div className={css.plan}>
        <h4 className={css.heading}>{t('planTitle')}</h4>
        <ul className={css.planList}>
          {pending.plan.components.map(component => <li key={component.component}>
            <span className={css.planComponent}>{t(COMPONENT_COPY[component.component])}</span>
            {component.added.length > 0 && <span>{t('planAdded') + ': ' + component.added.join(', ')}</span>}
            {component.replaced.length > 0 && <span>{t('planReplaced') + ': ' + component.replaced.join(', ')}</span>}
          </li>)}
        </ul>
        <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => { void apply() }}>
          {t('importApply')}
        </Button>
      </div>}
      {applied !== null && <div className={css.applied} role="status">
        <p>{t('importApplied')}</p>
        <p>{t('importBackupDir')} <code>{applied.backupDir}</code></p>
      </div>}
      {failure === 'import' && <p className={css.failure} role="alert">{t('importFailed')}</p>}
    </div>

    <div className={css.group}>
      <h3 className={css.heading}>{t('syncHeading')}</h3>
      <p className={css.hint}>{t('syncHint')}</p>
      <Button variant="outline" size="sm" disabled={syncing}
        onClick={() => { void refresh() }}>{t('syncRefresh')}</Button>
      {remotes?.map(remote => <div key={remote.id} className={css.remote}>
        <div className={css.remoteHead}>
          <span className={css.remoteId}>{remote.id}</span>
          <span className={css.hint}>{remote.kind}</span>
        </div>
        <div className={css.checks}>
          <Button variant="outline" size="sm" disabled={syncing || selected.length === 0}
            onClick={() => { void push(remote.id) }}>{t('syncPush')}</Button>
        </div>
        {remote.entries.length === 0
          ? <p className={css.hint}>{t('syncEmpty')}</p>
          : <ul className={css.planList}>
            {remote.entries.map(entry => <li key={entry.name}>
              <span>{entry.name}</span>
              <Button variant="outline" size="sm" disabled={syncing}
                onClick={() => { void restore(remote.id, entry.name) }}>{t('syncRestore')}</Button>
            </li>)}
          </ul>}
      </div>)}
      {remotes !== null && remotes.length === 0 && <p className={css.hint}>{t('syncNone')}</p>}
      {synced !== null && <p className={css.applied} role="status">{t('syncPushed')} <code>{synced.name}</code></p>}
      {failure === 'sync' && <p className={css.failure} role="alert">{t('syncFailed')}</p>}
    </div>
  </section>
}
