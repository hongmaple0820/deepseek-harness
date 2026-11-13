/** Export, import and remote sync of this profile's portable user-data bundle. */
import { useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BACKUP_COMPONENTS,
  DEFAULT_COMPONENTS,
  applyBundle,
  exportUrl,
  fetchRemoteBundle,
  forgetRemote,
  previewBundle,
  probeRemote,
  pushBundle,
  remoteBundles,
  remoteList,
  saveRemote,
  type BackupComponent,
  type ProbeResult,
  type PushReceipt,
  type RemoteDraft,
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

type Copy = PropsLocale<'settings.userData'>['t']

const COMPONENT_COPY = {
  profile: 'componentProfile',
  settings: 'componentSettings',
  sessions: 'componentSessions',
  credentials: 'componentCredentials',
} as const satisfies Record<BackupComponent, string>

type Failure = 'import' | 'sync'

/** Text fields the add-remote form edits; secrets stay empty until typed. */
type Draft = {
  id: string
  kind: 'webdav' | 's3'
  url: string
  username: string
  password: string
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  keep: string
}

const EMPTY_DRAFT: Draft = {
  id: '',
  kind: 'webdav',
  url: '',
  username: '',
  password: '',
  endpoint: '',
  region: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  prefix: '',
  keep: '',
}

/** Drop blank fields so the Host applies its own defaults and keeps stored secrets. */
function draftOf(draft: Draft): RemoteDraft {
  const value = (text: string): string | undefined => text.trim() === '' ? undefined : text.trim()
  const url = value(draft.url)
  const username = value(draft.username)
  const password = value(draft.password)
  const endpoint = value(draft.endpoint)
  const region = value(draft.region)
  const bucket = value(draft.bucket)
  const accessKeyId = value(draft.accessKeyId)
  const secretAccessKey = value(draft.secretAccessKey)
  const prefix = value(draft.prefix)
  const keep = Number(draft.keep.trim())
  return {
    kind: draft.kind,
    ...url === undefined ? {} : { url },
    ...username === undefined ? {} : { username },
    ...password === undefined ? {} : { password },
    ...endpoint === undefined ? {} : { endpoint },
    ...region === undefined ? {} : { region },
    ...bucket === undefined ? {} : { bucket },
    ...accessKeyId === undefined ? {} : { accessKeyId },
    ...secretAccessKey === undefined ? {} : { secretAccessKey },
    ...prefix === undefined ? {} : { prefix },
    ...draft.keep.trim() === '' || !Number.isFinite(keep) ? {} : { keep },
  }
}

/** Whether the form names everything the chosen transport requires. */
function complete(draft: Draft): boolean {
  if (draft.id.trim() === '') return false
  return draft.kind === 'webdav' ? draft.url.trim() !== '' : draft.endpoint.trim() !== ''
}

function Field({ label, value, secret, onChange }: {
  label: string
  value: string
  secret?: boolean
  onChange: (value: string) => void
}) {
  return <label className={css.field}>
    <span className={css.fieldLabel}>{label}</span>
    <Input type={secret === true ? 'password' : 'text'} value={value}
      onChange={(event) => { onChange(event.target.value) }} />
  </label>
}

/** One remote row: its identity, its connection test and the bundles it holds. */
function RemoteRow({ remote, probe, probing, syncing, t, onProbe, onRemove, onPush, onRestore }: {
  remote: RemoteListing
  probe: ProbeResult | undefined
  probing: boolean
  syncing: boolean
  t: Copy
  onProbe: () => void
  onRemove: () => void
  onPush: () => void
  onRestore: (name: string) => void
}) {
  return <div className={css.remote}>
    <div className={css.remoteHead}>
      <span className={css.remoteId}>{remote.id}</span>
      <span className={css.hint}>{remote.kind} · {remote.source === 'stored' ? t('remoteStored') : t('remoteConfigured')}</span>
    </div>
    <div className={css.actions}>
      <Button variant="outline" size="sm" disabled={syncing || probing} onClick={onProbe}>{t('remoteTest')}</Button>
      <Button variant="outline" size="sm" disabled={syncing} onClick={onPush}>{t('syncPush')}</Button>
      {remote.source === 'stored' && <Button variant="ghost" size="sm" disabled={syncing} onClick={onRemove}>
        {t('remoteDelete')}
      </Button>}
    </div>
    {probe !== undefined && <p className={probe.ok ? css.ok : css.failure} role="status">
      {probe.ok ? t('remoteReachable') + ' · ' + String(probe.entries ?? 0) : t('remoteUnreachable')}
    </p>}
    {remote.entries.length === 0
      ? <p className={css.hint}>{t('syncEmpty')}</p>
      : <ul className={css.planList}>
        {remote.entries.map(entry => <li key={entry.name}>
          <span>{entry.name}</span>
          <Button variant="outline" size="sm" disabled={syncing}
            onClick={() => { onRestore(entry.name) }}>{t('syncRestore')}</Button>
        </li>)}
      </ul>}
  </div>
}

/**
 * Render the export selection, the import pipeline, the remotes and their outcomes.
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
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState<string | null>(null)
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult>>>({})

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

  const save = async (): Promise<void> => {
    /* v8 ignore next -- the save control renders only while the form is open. */
    if (draft === null) return
    setSaving(true)
    setFailure(null)
    try {
      await saveRemote(draft.id.trim(), draftOf(draft))
      setDraft(null)
      await reload()
    } catch {
      setFailure('sync')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setSyncing(true)
    setFailure(null)
    try {
      await forgetRemote(id)
      await reload()
    } catch {
      setFailure('sync')
    } finally {
      setSyncing(false)
    }
  }

  const probe = async (id: string): Promise<void> => {
    setProbing(id)
    try {
      const result = await probeRemote(id)
      setProbes(current => ({ ...current, [id]: result }))
    } catch (error) {
      setProbes(current => ({
        ...current,
        [id]: { ok: false, error: error instanceof Error ? error.message : String(error) },
      }))
    } finally {
      setProbing(null)
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
          {(pending.plan.placeholders ?? []).map(placeholder => <li key={placeholder}>
            <span className={css.planComponent}>{t('planPlaceholders')}</span>
            <span>{placeholder}</span>
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
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={syncing}
          onClick={() => { void refresh() }}>{t('syncRefresh')}</Button>
        <Button variant="outline" size="sm" disabled={saving}
          onClick={() => {
            setFailure(null)
            setDraft(draft === null ? EMPTY_DRAFT : null)
          }}>{t('remoteAdd')}</Button>
      </div>
      {draft !== null && <div className={css.form}>
        <Field label={t('remoteId')} value={draft.id}
          onChange={(id) => { setDraft({ ...draft, id }) }} />
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('remoteKind')}</span>
          <select className={css.select} value={draft.kind}
            onChange={(event) => { setDraft({ ...draft, kind: event.target.value === 's3' ? 's3' : 'webdav' }) }}>
            <option value="webdav">{t('remoteWebdav')}</option>
            <option value="s3">{t('remoteS3')}</option>
          </select>
        </label>
        {draft.kind === 'webdav' ? <>
          <Field label={t('remoteUrl')} value={draft.url} onChange={(url) => { setDraft({ ...draft, url }) }} />
          <Field label={t('remoteUsername')} value={draft.username}
            onChange={(username) => { setDraft({ ...draft, username }) }} />
          <Field label={t('remotePassword')} secret value={draft.password}
            onChange={(password) => { setDraft({ ...draft, password }) }} />
        </> : <>
          <Field label={t('remoteEndpoint')} value={draft.endpoint}
            onChange={(endpoint) => { setDraft({ ...draft, endpoint }) }} />
          <Field label={t('remoteRegion')} value={draft.region} onChange={(region) => { setDraft({ ...draft, region }) }} />
          <Field label={t('remoteBucket')} value={draft.bucket} onChange={(bucket) => { setDraft({ ...draft, bucket }) }} />
          <Field label={t('remoteAccessKey')} value={draft.accessKeyId}
            onChange={(accessKeyId) => { setDraft({ ...draft, accessKeyId }) }} />
          <Field label={t('remoteSecretKey')} secret value={draft.secretAccessKey}
            onChange={(secretAccessKey) => { setDraft({ ...draft, secretAccessKey }) }} />
        </>}
        <Field label={t('remotePrefix')} value={draft.prefix}
          onChange={(prefix) => { setDraft({ ...draft, prefix }) }} />
        <Field label={t('remoteKeep')} value={draft.keep} onChange={(keep) => { setDraft({ ...draft, keep }) }} />
        <div className={css.actions}>
          <Button variant="primary" size="sm" disabled={saving || !complete(draft)}
            onClick={() => { void save() }}>{t('remoteSave')}</Button>
          <Button variant="outline" size="sm" disabled={saving}
            onClick={() => { setDraft(null) }}>{t('remoteCancel')}</Button>
        </div>
      </div>}
      {remotes?.map(remote => <RemoteRow key={remote.id} remote={remote} t={t}
        probe={probes[remote.id]} probing={probing === remote.id} syncing={syncing}
        onProbe={() => { void probe(remote.id) }}
        onRemove={() => { void remove(remote.id) }}
        onPush={() => { void push(remote.id) }}
        onRestore={(name) => { void restore(remote.id, name) }} />)}
      {remotes !== null && remotes.length === 0 && <p className={css.hint}>{t('syncNone')}</p>}
      {synced !== null && <p className={css.applied} role="status">{t('syncPushed')} <code>{synced.name}</code></p>}
      {failure === 'sync' && <p className={css.failure} role="alert">{t('syncFailed')}</p>}
    </div>
  </section>
}
