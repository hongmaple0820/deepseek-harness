/** Wire calls and pure helpers behind the user-data bundle settings section. */

/** One component a bundle can carry. */
export type BackupComponent = 'profile' | 'settings' | 'sessions' | 'credentials'

/** Components in the order the section lists them. */
export const BACKUP_COMPONENTS: readonly BackupComponent[] = ['profile', 'settings', 'sessions', 'credentials']

/** Components a new selection starts with. */
export const DEFAULT_COMPONENTS: readonly BackupComponent[] = ['profile', 'settings']

/** Restore decisions for one component, as the Host reports them. */
export interface ComponentPlan {
  readonly component: BackupComponent
  readonly added: readonly string[]
  readonly replaced: readonly string[]
  readonly skipped: readonly string[]
}

/** What an import would change, and where replaced files were saved. */
export interface RestorePlan {
  readonly components: readonly ComponentPlan[]
  readonly backupDir: string
  /** Marked secret values no local file could fill, as "path: key, key". */
  readonly placeholders?: readonly string[]
}

/** Which secret fields one remote carries a value for. */
export interface RemoteSecrets {
  readonly username: boolean
  readonly password: boolean
  readonly accessKeyId: boolean
  readonly secretAccessKey: boolean
}

/** One remote the Host can push bundles to, as the page renders it. */
export interface RemoteInfo {
  readonly id: string
  readonly kind: 'webdav' | 's3'
  /** Whether configuration or the settings page supplied the remote. */
  readonly source: 'config' | 'stored'
  readonly url?: string
  readonly endpoint?: string
  readonly bucket?: string
  readonly prefix?: string
  /** Newest bundles a push keeps on the remote. */
  readonly keep: number
  readonly secrets: RemoteSecrets
}

/** Fields the settings page submits for one remote. */
export interface RemoteDraft {
  readonly kind: 'webdav' | 's3'
  readonly url?: string
  readonly username?: string
  readonly password?: string
  readonly endpoint?: string
  readonly region?: string
  readonly bucket?: string
  readonly accessKeyId?: string
  readonly secretAccessKey?: string
  readonly prefix?: string
  readonly keep?: number
}

/** What one probe of a remote found. */
export interface ProbeResult {
  readonly ok: boolean
  readonly entries?: number
  readonly error?: string
}

/** One bundle already stored on a remote. */
export interface RemoteBundle {
  readonly name: string
  readonly size?: number
}

/** A remote together with the bundles it holds. */
export interface RemoteListing extends RemoteInfo {
  readonly entries: readonly RemoteBundle[]
}

/** Outcome of one push. */
export interface PushReceipt {
  readonly name: string
  readonly pruned: readonly string[]
}

const EXPORT_PATH = '/api/user-data.export'
const PREVIEW_PATH = '/api/user-data.import.preview'
const IMPORT_PATH = '/api/user-data.import'
const REMOTES_PATH = '/api/user-data.remotes'
const PUSH_PATH = '/api/user-data.sync.push'
const SYNC_LIST_PATH = '/api/user-data.sync.list'
const SYNC_BUNDLE_PATH = '/api/user-data.sync.bundle'
const REMOTES_SAVE_PATH = '/api/user-data.remotes.save'
const REMOTES_DELETE_PATH = '/api/user-data.remotes.delete'
const REMOTES_TEST_PATH = '/api/user-data.remotes.test'

/**
 * Address the export route for one selection.
 * @param components - components to include.
 * @returns the document-relative export URL.
 */
export function exportUrl(components: readonly BackupComponent[]): string {
  return EXPORT_PATH + '?components=' + components.join(',')
}

/**
 * Ask the Host to apply an import.
 * @param bytes - the bundle ZIP.
 * @param request - fetch implementation.
 * @returns the applied plan.
 */
export async function applyBundle(bytes: Uint8Array, request: typeof fetch = fetch): Promise<RestorePlan> {
  return readPlan(await request(IMPORT_PATH, { method: 'POST', body: new Uint8Array(bytes) }))
}

/**
 * Ask the Host what an import would change without writing it.
 * @param bytes - the bundle ZIP.
 * @param request - fetch implementation.
 * @returns the planned decisions.
 */
export async function previewBundle(bytes: Uint8Array, request: typeof fetch = fetch): Promise<RestorePlan> {
  return readPlan(await request(PREVIEW_PATH, { method: 'POST', body: new Uint8Array(bytes) }))
}

/**
 * Read the remotes the deployment configured.
 * @param request - fetch implementation.
 * @returns the remotes a push may address.
 */
export async function remoteList(request: typeof fetch = fetch): Promise<readonly RemoteInfo[]> {
  return readJson<RemoteInfo[]>(await request(REMOTES_PATH))
}

/**
 * Add or replace a remote the settings page manages.
 * @param id - remote id the page chose.
 * @param draft - transport fields the form collected.
 * @param request - fetch implementation.
 * @returns the stored remote as the page renders it.
 */
export async function saveRemote(
  id: string,
  draft: RemoteDraft,
  request: typeof fetch = fetch,
): Promise<RemoteInfo> {
  const response = await request(REMOTES_SAVE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, remote: draft }),
  })
  return readJson<RemoteInfo>(response)
}

/**
 * Remove a remote the settings page added.
 * @param id - remote id to forget.
 * @param request - fetch implementation.
 * @returns resolves once the Host removed the record.
 */
export async function forgetRemote(id: string, request: typeof fetch = fetch): Promise<void> {
  const response = await request(REMOTES_DELETE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  await readJson<{ deleted: string }>(response)
}

/**
 * Probe one remote with a single listing request.
 * @param id - remote id to probe.
 * @param request - fetch implementation.
 * @returns whether the transport answered, how many bundles it holds, or why it failed.
 */
export async function probeRemote(id: string, request: typeof fetch = fetch): Promise<ProbeResult> {
  const response = await request(REMOTES_TEST_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return readJson<ProbeResult>(response)
}

/**
 * Read the bundles one remote holds.
 * @param id - remote id.
 * @param request - fetch implementation.
 * @returns the stored bundles.
 */
export async function remoteBundles(id: string, request: typeof fetch = fetch): Promise<readonly RemoteBundle[]> {
  const body = await readJson<{ entries: RemoteBundle[] }>(await request(SYNC_LIST_PATH + '?id=' + encodeURIComponent(id)))
  return body.entries
}

/**
 * Upload a fresh bundle of one selection to a remote.
 * @param id - remote id.
 * @param components - components to include.
 * @param request - fetch implementation.
 * @returns the stored name and the pruned names.
 */
export async function pushBundle(
  id: string,
  components: readonly BackupComponent[],
  request: typeof fetch = fetch,
): Promise<PushReceipt> {
  const query = '?id=' + encodeURIComponent(id) + '&components=' + components.join(',')
  return readJson<PushReceipt>(await request(PUSH_PATH + query, { method: 'POST' }))
}

/**
 * Download one stored bundle so the preview and apply routes can read it.
 * @param id - remote id.
 * @param name - stored bundle name.
 * @param request - fetch implementation.
 * @returns the bundle ZIP.
 */
export async function fetchRemoteBundle(
  id: string,
  name: string,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await request(SYNC_BUNDLE_PATH + '?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name))
  if (!response.ok) throw new Error(`user-data-backup answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`user-data-backup answered ${response.status}`)
  return await response.json() as T
}

async function readPlan(response: Response): Promise<RestorePlan> {
  if (!response.ok) throw new Error(`user-data-backup answered ${response.status}`)
  return await response.json() as RestorePlan
}
