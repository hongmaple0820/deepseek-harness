/**
 * Remote targets a user adds from the settings page, kept as credential records
 * so the transport passwords never reach a settings file or the browser.
 * @module @deepseek-ai/dsh-user-data-backup/remote-store
 */

import {
  credentialKey,
  credentialKeyId,
  credentialKeyScope,
  type CredentialProvider,
} from '@deepseek-ai/dsh-credentials'

/** Owner scope of every record this package writes. */
export const REMOTE_SCOPE = 'user-data-backup'

const REMOTE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** One remote target as configuration or the settings page spells it. */
export interface RemoteSettings {
  /** Transport the remote speaks. */
  readonly kind: 'webdav' | 's3'
  /** WebDAV collection URL. */
  readonly url?: string
  /** WebDAV basic-auth user. */
  readonly username?: string
  /** WebDAV basic-auth password. */
  readonly password?: string
  /** S3 endpoint origin. */
  readonly endpoint?: string
  /** S3 signing region. */
  readonly region?: string
  /** S3 bucket name. */
  readonly bucket?: string
  /** S3 access key id. */
  readonly accessKeyId?: string
  /** S3 secret access key. */
  readonly secretAccessKey?: string
  /** Prefix below the collection or bucket root. */
  readonly prefix?: string
  /** Newest bundles a push keeps on this remote. */
  readonly keep?: number
}

/** One remote as a settings page may render it: never the secret values. */
export interface RemoteView {
  /** Id pushes address. */
  readonly id: string
  /** Transport the remote speaks. */
  readonly kind: 'webdav' | 's3'
  /** Where the id came from. */
  readonly source: 'config' | 'stored'
  /** WebDAV collection URL. */
  readonly url?: string
  /** S3 endpoint origin. */
  readonly endpoint?: string
  /** S3 bucket name. */
  readonly bucket?: string
  /** Prefix below the collection or bucket root. */
  readonly prefix?: string
  /** Newest bundles a push keeps on this remote. */
  readonly keep: number
  /** Which secret fields the remote carries a value for. */
  readonly secrets: Readonly<Record<'username' | 'password' | 'accessKeyId' | 'secretAccessKey', boolean>>
}

/** Bundles a push keeps when its remote sets no budget. */
export const DEFAULT_KEEP = 10

function needed(value: string | undefined, remote: string, field: string): string {
  if (value === undefined || value === '') throw new Error('remote ' + remote + ' needs ' + field)
  return value
}

/**
 * Refuse a remote the transport could not address.
 * @param id Id a push would address the remote by.
 * @param settings Fields the settings page or configuration supplied.
 * @returns The settings with their defaults filled in.
 */
export function validateRemote(id: string, settings: RemoteSettings): RemoteSettings {
  if (!REMOTE_ID.test(id)) throw new Error('remote id "' + id + '" must match ' + String(REMOTE_ID))
  const kind: string = settings.kind
  if (kind !== 'webdav' && kind !== 's3') throw new Error('remote ' + id + ' needs kind webdav or s3')
  if (kind === 'webdav') {
    needed(settings.url, id, 'url')
    return settings
  }
  needed(settings.endpoint, id, 'endpoint')
  needed(settings.region, id, 'region')
  needed(settings.bucket, id, 'bucket')
  needed(settings.accessKeyId, id, 'accessKeyId')
  needed(settings.secretAccessKey, id, 'secretAccessKey')
  return settings
}

/**
 * Describe a remote without its secrets.
 * @param id Id the remote is addressed by.
 * @param settings Fields the remote was configured with.
 * @param source Whether configuration or the settings page supplied it.
 * @returns The view the settings page renders.
 */
export function viewOf(id: string, settings: RemoteSettings, source: 'config' | 'stored'): RemoteView {
  const set = (value: string | undefined): boolean => value !== undefined && value !== ''
  return {
    id,
    kind: settings.kind,
    source,
    ...settings.url === undefined ? {} : { url: settings.url },
    ...settings.endpoint === undefined ? {} : { endpoint: settings.endpoint },
    ...settings.bucket === undefined ? {} : { bucket: settings.bucket },
    ...settings.prefix === undefined ? {} : { prefix: settings.prefix },
    keep: settings.keep ?? DEFAULT_KEEP,
    secrets: {
      username: set(settings.username),
      password: set(settings.password),
      accessKeyId: set(settings.accessKeyId),
      secretAccessKey: set(settings.secretAccessKey),
    },
  }
}

/**
 * Keep the secrets a stored remote already carries where a new draft leaves them blank.
 * @param incoming Fields the settings page submitted.
 * @param stored Settings the same id was saved with before, when it existed.
 * @returns The draft with the stored secret values filled in.
 */
export function withStoredSecrets(incoming: RemoteSettings, stored: RemoteSettings | undefined): RemoteSettings {
  if (stored === undefined) return incoming
  return {
    ...incoming,
    ...incoming.username === undefined || incoming.username === '' ? { username: stored.username } : {},
    ...incoming.password === undefined || incoming.password === '' ? { password: stored.password } : {},
    ...incoming.accessKeyId === undefined || incoming.accessKeyId === '' ? { accessKeyId: stored.accessKeyId } : {},
    ...incoming.secretAccessKey === undefined || incoming.secretAccessKey === '' ? { secretAccessKey: stored.secretAccessKey } : {},
  }
}

function storedSettings(payload: unknown): RemoteSettings | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const kind = (payload as { kind?: unknown }).kind
  return kind === 'webdav' || kind === 's3' ? payload as RemoteSettings : undefined
}

/**
 * Read every remote the user added from the settings page.
 * @param credentials Credential store holding the records, when the deployment has one.
 * @returns Settings by remote id.
 */
export async function readStoredRemotes(credentials: CredentialProvider | undefined): Promise<Map<string, RemoteSettings>> {
  const remotes = new Map<string, RemoteSettings>()
  if (credentials === undefined) return remotes
  for (const entry of await credentials.listRecords()) {
    if (credentialKeyScope(entry.key) !== REMOTE_SCOPE) continue
    const record = await credentials.readRecord(entry.key)
    if (record?.kind !== 'grant') continue
    const settings = storedSettings(record.payload)
    if (settings !== undefined) remotes.set(credentialKeyId(entry.key), settings)
  }
  return remotes
}

/**
 * Write one remote into the credential store, replacing what the id held.
 * @param credentials Credential store that keeps the record.
 * @param id Id a push addresses the remote by.
 * @param settings Validated fields of the remote.
 * @returns Resolves once the record is stored.
 */
export async function saveRemote(credentials: CredentialProvider, id: string, settings: RemoteSettings): Promise<void> {
  await credentials.modifyRecord(credentialKey(REMOTE_SCOPE, id), () => Promise.resolve({ kind: 'grant', payload: settings }))
}

/**
 * Remove one remote from the credential store; an absent id is a no-op.
 * @param credentials Credential store that keeps the record.
 * @param id Id whose record is removed.
 * @returns Resolves once the record is gone.
 */
export async function deleteRemote(credentials: CredentialProvider, id: string): Promise<void> {
  await credentials.deleteRecord(credentialKey(REMOTE_SCOPE, id))
}
