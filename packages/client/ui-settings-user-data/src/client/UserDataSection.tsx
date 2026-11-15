/** Export, import and remote sync of this profile's portable user-data bundle. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, fileSizeText, Input } from '@deepseek-ai/dsh-client-ui-primitives'
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
  RemoteTimeoutError,
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

/** The sync card reports its own failure, so an import problem never hides a listing that failed to load. */
type SyncFailure = 'none' | 'failed' | 'unreachable' | 'timeout' | 'stale'

/** The remote call in flight, so the row that started it reports what it is doing. */
type PendingOp = {
  readonly kind: 'push' | 'remove' | 'restore'
  readonly id: string
  readonly name?: string
}

/** Bytes of a bundle download as they arrived, with the total when the transport declared one. */
type DownloadProgress = {
  readonly loaded: number
  readonly total: number | undefined
}

/** A connection test together with the moment it ran, so a stale listing is visible. */
type ProbeRecord = {
  readonly result: ProbeResult
  readonly at: number
}

/** The remote and bundle a fetched backup came from. */
type Origin = { readonly remote: string; readonly name: string }

/** Where a previewed bundle came from: the file just chosen, or the remote a row read it from. */
type Source =
  | { readonly origin: Origin }
  | { readonly file: string }

/** A previewed bundle with the place it was read from. */
type Preview = {
  readonly plan: RestorePlan
  readonly bytes: Uint8Array
  readonly source: Source
}

/** What an applied bundle left behind, keeping the remote it came from. */
type Applied = {
  readonly receipt: RestorePlan
  readonly origin?: Origin
}

/** Two-digit local clock of a probe result. */
function clock(at: number): string {
  const stamp = new Date(at)
  return `${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
}

/** Which sync failure a rejection is: a transport failure rejects before the Host answers at all. */
function syncFailureOf(error: unknown): SyncFailure {
  if (error instanceof RemoteTimeoutError) return 'timeout'
  return error instanceof TypeError ? 'unreachable' : 'failed'
}

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

/** Whether the Host could read a remote address: a URL parses only when it names a scheme. */
function parses(text: string): boolean {
  return URL.canParse(text)
}

/** The address field the chosen transport requires. */
function addressOf(draft: Draft): string {
  return draft.kind === 'webdav' ? draft.url : draft.endpoint
}

/** Whether the form names everything the chosen transport requires. */
function complete(draft: Draft): boolean {
  if (draft.id.trim() === '') return false
  const address = addressOf(draft).trim()
  return address !== '' && parses(address)
}

/** Whether the address is present but would not parse. */
function malformed(draft: Draft): boolean {
  const address = addressOf(draft).trim()
  return address !== '' && !parses(address)
}

function Field({ label, value, secret, wide, note, onChange }: {
  label: string
  value: string
  secret?: boolean
  wide?: boolean
  note?: string | undefined
  onChange: (value: string) => void
}) {
  return <div className={wide === true ? `${css.field} ${css.wide}` : css.field}>
    <label className={css.fieldControl}>
      <span className={css.fieldLabel}>{label}</span>
      <Input type={secret === true ? 'password' : 'text'} value={value}
        onChange={(event) => { onChange(event.target.value) }} />
    </label>
    {note !== undefined && <span className={css.fieldNote}>{note}</span>}
  </div>
}

/** File totals across every component of a plan, so the preview says how much it would change. */
function totals(plan: RestorePlan): { readonly added: number; readonly replaced: number; readonly skipped: number } {
  return plan.components.reduce((sum, component) => ({
    added: sum.added + component.added.length,
    replaced: sum.replaced + component.replaced.length,
    skipped: sum.skipped + component.skipped.length,
  }), { added: 0, replaced: 0, skipped: 0 })
}

/** Where a previewed bundle came from, named the way the card laid it out. */
function sourceLine(source: Source, t: Copy): string {
  return 'origin' in source
    ? t('planOrigin') + ': ' + source.origin.remote + ' · ' + source.origin.name
    : t('planFile') + ': ' + source.file
}

/** The changes a previewed bundle would make, headed by where it came from and how many files it touches. */
function PlanPreview({ plan, source, size, busy, t, onApply, onDismiss }: {
  plan: RestorePlan
  source: Source
  size: number
  busy: 'preview' | 'apply' | null
  t: Copy
  onApply: () => void
  onDismiss: () => void
}) {
  const total = totals(plan)
  const dismiss = useRef<HTMLButtonElement>(null)

  /* The preview takes the place of the empty state, so focus follows it instead of staying on a control that is gone. */
  useEffect(() => {
    dismiss.current?.focus()
  }, [])

  return <div className={css.surface}>
    <div className={css.surfaceHead}>
      <h4 className={css.surfaceTitle}>{t('planTitle')}</h4>
      {/* The size rides beside the name the way an entry's size does, so a large bundle is visible before it is written. */}
      <p className={css.surfaceOrigin}>{sourceLine(source, t) + ' · ' + fileSizeText(size)}</p>
    </div>
    <p className={css.surfaceTotals}>
      <span>{t('planAdded') + ' ' + String(total.added)}</span>
      <span>{t('planReplaced') + ' ' + String(total.replaced)}</span>
      <span>{t('planSkipped') + ' ' + String(total.skipped)}</span>
    </p>
    <ul className={css.planList}>
      {plan.components.map(component => <li key={component.component}>
        <span className={css.planComponent}>{t(COMPONENT_COPY[component.component])}</span>
        {component.added.length > 0 && <span className={css.planDetail}>
          {t('planAdded') + ': ' + component.added.join(', ')}
        </span>}
        {component.replaced.length > 0 && <span className={css.planDetail}>
          {t('planReplaced') + ': ' + component.replaced.join(', ')}
        </span>}
      </li>)}
      {(plan.placeholders ?? []).map(placeholder => <li key={placeholder}>
        <span className={css.planComponent}>{t('planPlaceholders')}</span>
        <span className={css.planDetail}>{placeholder}</span>
      </li>)}
    </ul>
    <div className={css.surfaceFoot}>
      <Button variant="outline" size="md" ref={dismiss} disabled={busy !== null} onClick={onDismiss}>
        {t('planDismiss')}
      </Button>
      <Button variant="primary" size="md" disabled={busy !== null} onClick={onApply}>
        {t('importApply')}
      </Button>
    </div>
  </div>
}

/** One remote row: its identity, its connection test and the bundles it holds. */
function RemoteRow({ remote, probe, probing, syncing, pushing, restoring, progress, receipt, confirming, pushable, t,
  onProbe, onConfirmDelete, onCancelDelete, onRemove, onPush, onRestore }: {
  remote: RemoteListing
  probe: ProbeRecord | undefined
  probing: boolean
  syncing: boolean
  pushing: boolean
  restoring: string | undefined
  progress: DownloadProgress | null
  receipt: PushReceipt | undefined
  confirming: boolean
  pushable: boolean
  t: Copy
  onProbe: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onRemove: () => void
  onPush: () => void
  onRestore: (name: string) => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)

  /* Ask from the confirmation itself, then hand focus back to the control that asked. */
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus()
    } else if (wasConfirming.current) {
      /* v8 ignore next -- only a stored remote offers the delete control this confirmation came from. */
      deleteRef.current?.focus()
    }
    wasConfirming.current = confirming
  }, [confirming])

  return <div className={css.remote}>
    <div className={css.remoteHead}>
      <div className={css.remoteIdentity}>
        <span className={css.remoteId}>{remote.id}</span>
        <span className={css.remoteMeta}>{remote.kind} · {remote.source === 'stored' ? t('remoteStored') : t('remoteConfigured')}</span>
      </div>
      <div className={css.rowActions}>
        {confirming ? <>
          <Button variant="ghost" size="sm" className={css.dangerAction} disabled={syncing}
            ref={confirmRef} onClick={onRemove}>{t('remoteDeleteConfirm')}</Button>
          <Button variant="ghost" size="sm" disabled={syncing} onClick={onCancelDelete}>
            {t('remoteCancel')}
          </Button>
        </> : <>
          <Button variant="ghost" size="sm" disabled={syncing || probing} onClick={onProbe}>{t('remoteTest')}</Button>
          <Button variant="ghost" size="sm" disabled={syncing || !pushable} onClick={onPush}>
            {pushing ? t('syncPushing') : t('syncPush')}
          </Button>
          {remote.source === 'stored' && <Button variant="ghost" size="sm" className={css.dangerAction}
            ref={deleteRef} disabled={syncing} onClick={onConfirmDelete}>
            {t('remoteDelete')}
          </Button>}
        </>}
      </div>
    </div>
    {confirming && <p className={css.confirmScope}>{t('remoteDeleteScope')}</p>}
    {probe !== undefined && <div className={css.probeRow}>
      <p className={probe.result.ok ? css.probeOk : css.probeBad} role="status">
        {probe.result.ok
          ? t('remoteReachable') + ' · ' + String(probe.result.entries ?? 0)
          : t('remoteUnreachable')}
      </p>
      <span className={css.probeWhen} title={new Date(probe.at).toISOString()}>{clock(probe.at)}</span>
    </div>}
    {receipt !== undefined && <p className={css.receipt} role="status">
      {t('syncPushed') + ' · ' + fileSizeText(receipt.size)}
    </p>}
    {receipt !== undefined && receipt.pruned.length > 0 && <p className={css.receipt} role="status">
      {t('syncPruned') + ' ' + String(receipt.pruned.length)}
    </p>}
    {remote.entries.length === 0
      ? <p className={css.remoteEmpty}>{t('syncEmpty')}</p>
      : <ul className={css.entries}>
        {remote.entries.map(entry => <li key={entry.name}>
          <span className={css.entryName} title={entry.name}>{entry.name}</span>
          {entry.size !== undefined && <span className={css.entrySize}>{fileSizeText(entry.size)}</span>}
          <Button variant="ghost" size="sm" disabled={syncing}
            onClick={() => { onRestore(entry.name) }}>
            {restoring === entry.name ? t('syncRestoring') : t('syncRestore')}
          </Button>
        </li>)}
      </ul>}
    {/* The download counts its bytes as they arrive, so a large bundle says how far it has come. */}
    {restoring !== undefined && progress !== null && <p className={css.progress} role="status">
      {fileSizeText(progress.loaded) + (progress.total === undefined ? '' : ' / ' + fileSizeText(progress.total))}
    </p>}
  </div>
}

/**
 * Render the export selection, the import pipeline, the remotes and their outcomes.
 * @param props - download action and localized copy.
 * @returns the User data settings section.
 */
export function UserDataSection({ download, t }: Face) {
  const picker = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const importChoice = useRef<HTMLButtonElement>(null)
  const hadPreview = useRef(false)
  const [selected, setSelected] = useState<readonly BackupComponent[]>(DEFAULT_COMPONENTS)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [importFailure, setImportFailure] = useState(false)
  const [syncFailure, setSyncFailure] = useState<SyncFailure>('none')
  const [pending, setPending] = useState<Preview | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [remotes, setRemotes] = useState<readonly RemoteListing[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [operation, setOperation] = useState<PendingOp | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [receipts, setReceipts] = useState<Readonly<Record<string, PushReceipt>>>({})
  const [started, setStarted] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeRecord>>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [listedAt, setListedAt] = useState<number | null>(null)

  const formOpen = draft !== null
  const syncing = saving || operation !== null

  /* The form and the list both report the same failure, but each shows it next to what the user touched. */
  const syncNote = syncFailure === 'none' || syncFailure === 'stale'
    ? null
    : <p className={css.failure} role="alert">
      {syncFailure === 'unreachable' ? t('syncUnreachable')
        : syncFailure === 'timeout' ? t('syncTimeout')
          : t('syncFailed')}
    </p>

  /* The sync card is last, so the form it opens can reach below the panel fold. */
  useEffect(() => {
    const element = editor.current
    if (!formOpen || element === null) return
    element.scrollIntoView({ block: 'nearest' })
  }, [formOpen])

  /* The preview opens beside the choose control; once it is gone, focus goes back to the control that opened it. */
  useEffect(() => {
    if (pending !== null) {
      hadPreview.current = true
      return
    }
    if (!hadPreview.current) return
    hadPreview.current = false
    /* v8 ignore next -- the card that asked for the preview keeps its choose control mounted. */
    importChoice.current?.focus()
  }, [pending])

  const toggle = (component: BackupComponent, enabled: boolean): void => {
    setStarted(false)
    setSelected(current => enabled
      ? BACKUP_COMPONENTS.filter(candidate => candidate === component || current.includes(candidate))
      : current.filter(candidate => candidate !== component))
  }

  const choose = async (file: File | undefined): Promise<void> => {
    /* v8 ignore next -- the file input reports an empty list only through its cancel path, which no change event carries. */
    if (file === undefined) return
    setBusy('preview')
    setImportFailure(false)
    setApplied(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setPending({ plan: await previewBundle(bytes), bytes, source: { file: file.name } })
    } catch {
      setPending(null)
      setImportFailure(true)
    } finally {
      setBusy(null)
    }
  }

  const apply = async (): Promise<void> => {
    /* v8 ignore next -- the apply control renders only while a preview is pending. */
    if (pending === null) return
    setBusy('apply')
    setImportFailure(false)
    try {
      const receipt = await applyBundle(pending.bytes)
      setApplied('origin' in pending.source ? { receipt, origin: pending.source.origin } : { receipt })
      setPending(null)
    } catch {
      setImportFailure(true)
    } finally {
      setBusy(null)
    }
  }

  const reload = useCallback(async (): Promise<readonly RemoteListing[]> => {
    const listings = await Promise.all((await remoteList()).map(async remote => ({
      ...remote,
      entries: await remoteBundles(remote.id),
    })))
    setRemotes(listings)
    setListedAt(Date.now())
    return listings
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setSyncFailure('none')
    setReceipts({})
    try {
      await reload()
    } catch (error) {
      /* The rows a failed read could not replace stay on screen; the note beside them carries the failure. */
      setSyncFailure(syncFailureOf(error))
    } finally {
      setLoading(false)
    }
  }, [reload])

  /* A write that succeeded still deserves its receipt when only the listing behind it failed. */
  const freshList = async (): Promise<void> => {
    try {
      await reload()
    } catch {
      setSyncFailure('stale')
    }
  }

  /* The page opens showing the remotes this deployment configures, not an instruction to ask for them. */
  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (): Promise<void> => {
    /* v8 ignore next -- the save control renders only while the form is open. */
    if (draft === null) return
    setSaving(true)
    setSyncFailure('none')
    try {
      await saveRemote(draft.id.trim(), draftOf(draft))
      setDraft(null)
      await freshList()
    } catch (error) {
      setSyncFailure(syncFailureOf(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setOperation({ kind: 'remove', id })
    setSyncFailure('none')
    try {
      await forgetRemote(id)
      await freshList()
    } catch (error) {
      setSyncFailure(syncFailureOf(error))
    } finally {
      setOperation(null)
      setConfirming(null)
    }
  }

  const probe = async (id: string): Promise<void> => {
    setProbing(id)
    try {
      const result = await probeRemote(id)
      setProbes(current => ({ ...current, [id]: { result, at: Date.now() } }))
    } catch (error) {
      setProbes(current => ({
        ...current,
        [id]: {
          result: { ok: false, error: error instanceof Error ? error.message : String(error) },
          at: Date.now(),
        },
      }))
    } finally {
      setProbing(null)
    }
  }

  const dropReceipt = (id: string): void => {
    setReceipts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
  }

  /* One sweep tests the rows in the order they are listed, so the verdicts fill in top to bottom. */
  const probeAll = async (): Promise<void> => {
    /* v8 ignore next -- the control renders only while the list holds a remote to test. */
    if (remotes === null || remotes.length === 0) return
    setTesting(true)
    try {
      for (const remote of remotes) {
        await probe(remote.id)
      }
    } finally {
      setTesting(false)
    }
  }

  const push = async (id: string): Promise<void> => {
    setOperation({ kind: 'push', id })
    setSyncFailure('none')
    dropReceipt(id)
    try {
      const receipt = await pushBundle(id, selected)
      setReceipts(current => ({ ...current, [id]: receipt }))
      await freshList()
    } catch (error) {
      dropReceipt(id)
      setSyncFailure(syncFailureOf(error))
    } finally {
      setOperation(null)
    }
  }

  const restore = async (id: string, name: string): Promise<void> => {
    setOperation({ kind: 'restore', id, name })
    setSyncFailure('none')
    setApplied(null)
    try {
      const bytes = await fetchRemoteBundle(id, name, fetch, (loaded, total) => { setProgress({ loaded, total }) })
      setPending({ plan: await previewBundle(bytes), bytes, source: { origin: { remote: id, name } } })
    } catch (error) {
      setPending(null)
      setSyncFailure(syncFailureOf(error))
    } finally {
      setOperation(null)
      setProgress(null)
    }
  }

  return <section className={css.section}>
    <header className={css.intro}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
    </header>

    <section className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardIntro}>
          <h3 className={css.heading}>{t('exportHeading')}</h3>
          <p className={css.hint}>{t('exportHint')}</p>
        </div>
        <div className={`${css.cardActions} ${css.actionColumn}`}>
          <Button variant="primary" size="md" disabled={selected.length === 0}
            onClick={() => {
              setStarted(true)
              download(exportUrl(selected))
            }}>{t('exportAction')}</Button>
          {started && <span className={css.actionNote} role="status">{t('exportStarted')}</span>}
        </div>
      </div>
      <div className={css.checks}>
        {BACKUP_COMPONENTS.map(component => <Checkbox key={component}
          className={css.check}
          checked={selected.includes(component)}
          label={t(COMPONENT_COPY[component])}
          onChange={(enabled) => { toggle(component, enabled) }} />)}
      </div>
      <p className={css.scope}>{t('exportSelected') + ' ' + String(selected.length) + ' / ' + String(BACKUP_COMPONENTS.length)}</p>
    </section>

    <section className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardIntro}>
          <h3 className={css.heading}>{t('importHeading')}</h3>
          <p className={css.hint}>{t('importHint')}</p>
        </div>
        <div className={css.cardActions}>
          <Button variant="outline" size="md" ref={importChoice} disabled={busy !== null}
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
        </div>
      </div>
      {pending === null && applied === null && !importFailure && busy !== 'preview'
        && <p className={`${css.emptyBox} ${css.importEmpty}`}>{t('importEmpty')}</p>}
      {pending !== null && <PlanPreview plan={pending.plan} source={pending.source} size={pending.bytes.byteLength} busy={busy}
        t={t} onApply={() => { void apply() }} onDismiss={() => { setPending(null) }} />}
      {applied !== null && <div className={css.applied} role="status">
        <p className={css.appliedTitle}>{applied.origin === undefined ? t('importApplied') : t('restoreApplied')}</p>
        {applied.origin !== undefined && <p className={css.appliedDetail}>
          {t('importAppliedFrom') + ': ' + applied.origin.remote + ' · ' + applied.origin.name}
        </p>}
        <p className={css.appliedDetail}>{t('importBackupDir')} <code>{applied.receipt.backupDir}</code></p>
      </div>}
      {importFailure && <p className={css.failure} role="alert">{t('importFailed')}</p>}
    </section>

    <section className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardIntro}>
          <h3 className={css.heading}>{t('syncHeading')}</h3>
          <p className={css.hint}>{t('syncHint')}</p>
          <p className={css.scope}>{t('syncScope')}: {selected.length === 0
            ? t('syncScopeNone')
            : selected.map(component => t(COMPONENT_COPY[component])).join(' / ')}</p>
        </div>
        <div className={`${css.cardActions} ${css.actionColumn}`}>
          <div className={css.buttonRow}>
            <Button variant="ghost" size="sm" disabled={loading || syncing}
              onClick={() => { void refresh() }}>{t('syncRefresh')}</Button>
            {remotes !== null && remotes.length > 0 && <Button variant="ghost" size="sm"
              disabled={loading || syncing || testing || probing !== null}
              onClick={() => { void probeAll() }}>{t('syncTestAll')}</Button>}
            {draft === null && (remotes === null || remotes.length > 0) && <Button variant="outline" size="sm"
              onClick={() => {
                setDraft(EMPTY_DRAFT)
              }}>{t('remoteAdd')}</Button>}
          </div>
          {listedAt !== null && <span className={css.actionNote}>
            {t('syncReadAt') + ' ' + clock(listedAt)}
          </span>}
        </div>
      </div>
      {draft !== null && <div className={css.editor} ref={editor}>
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
          <Field label={t('remoteUrl')} wide value={draft.url}
            note={malformed(draft) ? t('remoteUrlInvalid') : undefined}
            onChange={(url) => { setDraft({ ...draft, url }) }} />
          <Field label={t('remoteUsername')} value={draft.username}
            onChange={(username) => { setDraft({ ...draft, username }) }} />
          <Field label={t('remotePassword')} secret value={draft.password}
            onChange={(password) => { setDraft({ ...draft, password }) }} />
        </> : <>
          <Field label={t('remoteEndpoint')} wide value={draft.endpoint}
            note={malformed(draft) ? t('remoteUrlInvalid') : undefined}
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
        {syncNote}
        <div className={css.editorFoot}>
          <Button variant="primary" size="md" disabled={syncing || !complete(draft)}
            onClick={() => { void save() }}>{t('remoteSave')}</Button>
          <Button variant="outline" size="md" disabled={saving}
            onClick={() => { setDraft(null) }}>{t('remoteCancel')}</Button>
        </div>
      </div>}
      {/* A failed read is reported above the rows it could not replace, so the retry is read before them. */}
      {draft === null && syncNote !== null && <div className={css.noteRow}>
        {syncNote}
        <Button variant="ghost" size="sm" disabled={loading || syncing}
          onClick={() => { void refresh() }}>{t('syncRetry')}</Button>
      </div>}
      {remotes?.map(remote => <RemoteRow key={remote.id} remote={remote} t={t}
        probe={probes[remote.id]} probing={testing || probing === remote.id} syncing={syncing}
        pushing={operation?.kind === 'push' && operation.id === remote.id}
        restoring={operation?.kind === 'restore' && operation.id === remote.id ? operation.name : undefined}
        progress={operation?.kind === 'restore' && operation.id === remote.id ? progress : null}
        receipt={receipts[remote.id]}
        confirming={confirming === remote.id} pushable={selected.length > 0}
        onProbe={() => { void probe(remote.id) }}
        onConfirmDelete={() => { setConfirming(remote.id) }}
        onCancelDelete={() => { setConfirming(null) }}
        onRemove={() => { void remove(remote.id) }}
        onPush={() => { void push(remote.id) }}
        onRestore={(name) => { void restore(remote.id, name) }} />)}
      {loading && remotes === null && <p className={css.emptyBox}>{t('syncLoading')}</p>}
      {/* An empty list offers its own way in, so the first remote does not require finding the header control. */}
      {remotes !== null && remotes.length === 0 && draft === null && <div className={`${css.emptyBox} ${css.emptyState}`}>
        <p>{t('syncNone')}</p>
        <Button variant="outline" size="sm" onClick={() => { setDraft(EMPTY_DRAFT) }}>{t('remoteAdd')}</Button>
      </div>}
      {syncFailure === 'stale' && <p className={css.stale} role="status">{t('syncStale')}</p>}
    </section>
  </section>
}
