/**
 * Host service behind the portable user-data bundle: export, preview and import.
 * @module @deepseek-ai/dsh-user-data-backup
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import {
  type BackupComponent,
  type BundleManifest,
  type BundleSelection,
  type BundleValue,
  type SettingsSnapshot,
  bundleFileName,
  collectBundleFiles,
  createBundle,
  readBundle,
} from './bundle.ts'
import type { RemoteTarget } from './remote.ts'
import { createRemote, pruneRemote } from './remote.ts'
import { type RestorePlan, applyRestore, planRestore } from './restore.ts'
import {
  USER_DATA_EXPORT_PATH,
  USER_DATA_IMPORT_PATH,
  USER_DATA_IMPORT_PREVIEW_PATH,
  USER_DATA_REMOTES_PATH,
  USER_DATA_SYNC_BUNDLE_PATH,
  USER_DATA_SYNC_LIST_PATH,
  USER_DATA_SYNC_PUSH_PATH,
} from './routes.ts'

export * from './bundle.ts'
export * from './restore.ts'
export * from './remote.ts'
export {
  USER_DATA_EXPORT_PATH,
  USER_DATA_IMPORT_PATH,
  USER_DATA_IMPORT_PREVIEW_PATH,
  USER_DATA_REMOTES_PATH,
  USER_DATA_SYNC_BUNDLE_PATH,
  USER_DATA_SYNC_LIST_PATH,
  USER_DATA_SYNC_PUSH_PATH,
} from './routes.ts'

/** Components an export selects. */

/** Every component an export may select, in selection order. */
export const BACKUP_COMPONENTS: readonly BackupComponent[] = ['profile', 'settings', 'sessions', 'credentials']

/** Default selection of the settings page and the export route. */
export const DEFAULT_COMPONENTS: readonly BackupComponent[] = ['profile', 'settings']

/** One export as the Host produced it. */
export interface ExportedBundle {
  /** ZIP bytes. */
  readonly bytes: Uint8Array
  /** Download file name. */
  readonly fileName: string
  /** Manifest written first inside the ZIP. */
  readonly manifest: BundleManifest
}

/** Profile facts the routes and the client need before an export runs. */
export interface UserDataContext {
  /** Active profile name. */
  readonly profile: string
  /** DSH home directory. */
  readonly home: string
  /** Active profile directory. */
  readonly profileDir: string
}

interface ProfileLike {
  readonly name: string
  readonly home: string
  readonly dir: string
}

interface SettingsLike {
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>
}

interface ConnectionLike {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/** One configured remote as cordis.yml spells it. */
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

/** Backup policy. */
export interface Config {
  /** Version recorded in each manifest; resolved from the package manifest when absent. */
  readonly dshVersion?: string
  /** Remotes a push may address, by id. */
  readonly remotes?: Record<string, RemoteSettings>
}

/** Validate backup policy. */
export const Config: Schema<Config> = Schema.object({
  dshVersion: Schema.string(),
  remotes: Schema.dict(Schema.object({
    kind: Schema.union(['webdav', 's3'] as const).required(),
    url: Schema.string(),
    username: Schema.string(),
    password: Schema.string(),
    endpoint: Schema.string(),
    region: Schema.string(),
    bucket: Schema.string(),
    accessKeyId: Schema.string(),
    secretAccessKey: Schema.string(),
    prefix: Schema.string(),
    keep: Schema.number(),
  })),
})

const TIMESTAMP_ENCODER = (date: Date): string => date.toISOString()

/** Bundles a push keeps when its remote sets no budget. */
const DEFAULT_KEEP = 10

interface ConfiguredRemote {
  readonly kind: 'webdav' | 's3'
  readonly target: RemoteTarget
  readonly keep: number
}

function needed(value: string | undefined, remote: string, field: string): string {
  if (value === undefined || value === '') throw new Error('remote ' + remote + ' needs ' + field)
  return value
}

function remoteOf(id: string, settings: RemoteSettings): ConfiguredRemote {
  const prefix = settings.prefix === undefined || settings.prefix === '' ? {} : { prefix: settings.prefix }
  const keep = settings.keep ?? DEFAULT_KEEP
  if (settings.kind === 'webdav') {
    return {
      kind: 'webdav',
      keep,
      target: createRemote({
        kind: 'webdav',
        url: needed(settings.url, id, 'url'),
        ...settings.username === undefined ? {} : { username: settings.username },
        ...settings.password === undefined ? {} : { password: settings.password },
        ...prefix,
      }),
    }
  }
  return {
    kind: 's3',
    keep,
    target: createRemote({
      kind: 's3',
      endpoint: needed(settings.endpoint, id, 'endpoint'),
      region: needed(settings.region, id, 'region'),
      bucket: needed(settings.bucket, id, 'bucket'),
      accessKeyId: needed(settings.accessKeyId, id, 'accessKeyId'),
      secretAccessKey: needed(settings.secretAccessKey, id, 'secretAccessKey'),
      ...prefix,
    }),
  }
}

async function packageVersion(): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
    /* v8 ignore next -- the package manifest always declares a version. */
    return manifest.version ?? 'unknown'
  } catch (error) {
    /* v8 ignore start -- the published payload always carries package.json beside this module. */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unknown'
    throw error
    /* v8 ignore stop */
  }
}

function parseComponents(raw: string | null): readonly BackupComponent[] {
  if (raw === null || raw === '') return DEFAULT_COMPONENTS
  const names = raw.split(',').map(name => name.trim()).filter(name => name !== '')
  const unknown = names.filter(name => !BACKUP_COMPONENTS.includes(name as BackupComponent))
  if (unknown.length > 0) throw new Error('unknown backup components: ' + unknown.join(', '))
  return names as BackupComponent[]
}

function settingsSnapshot(settings: SettingsLike | undefined): SettingsSnapshot | undefined {
  if (settings === undefined) return undefined
  const sections: { ns: string; values: Record<string, BundleValue> }[] = []
  const secrets: SettingsSnapshot['secrets'][number][] = []
  for (const descriptor of settings.describe({ redactSecrets: true })) {
    if (descriptor.user !== undefined) sections.push({ ns: descriptor.ns, values: descriptor.user as Record<string, BundleValue> })
    for (const secret of descriptor.secrets ?? []) secrets.push({ ns: descriptor.ns, path: secret.path, set: secret.set })
  }
  return { sections, secrets }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Portable user-data service: assemble a bundle, preview a restore, and apply one.
 *
 * The service reads the active profile through `profileContext` and the settings
 * sections through the optional `settings` service, so a deployment without
 * settings offers the profile, sessions and credentials components only.
 */
export default class UserDataBackup extends Service {
  static inject = ['connection']

  private readonly dshVersion: string | undefined

  private readonly remotes: ReadonlyMap<string, ConfiguredRemote>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'userDataBackup')
    this.dshVersion = config.dshVersion
    this.remotes = new Map(Object.entries(config.remotes ?? {}).map(([id, settings]) => [id, remoteOf(id, settings)]))
    ctx.effect(() => {
      const connection = ctx.get('connection') as ConnectionLike | undefined
      /* v8 ignore next -- connection is a declared required inject, so cordis never activates this plugin without it. */
      if (connection === undefined) throw new Error('user-data-backup requires the connection service')
      const disposers = [
        connection.fetch.register({
          path: USER_DATA_EXPORT_PATH,
          methods: ['GET', 'HEAD'],
          requestBody: 'buffered',
          fetch: request => this.exportResponse(request),
        }),
        connection.fetch.register({
          path: USER_DATA_IMPORT_PREVIEW_PATH,
          methods: ['GET', 'HEAD', 'POST'],
          requestBody: 'buffered',
          fetch: request => this.previewResponse(request),
        }),
        connection.fetch.register({
          path: USER_DATA_IMPORT_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: request => this.applyResponse(request),
        }),
        connection.fetch.register({
          path: USER_DATA_REMOTES_PATH,
          methods: ['GET', 'HEAD'],
          requestBody: 'buffered',
          fetch: () => Promise.resolve(this.remotesResponse()),
        }),
        connection.fetch.register({
          path: USER_DATA_SYNC_PUSH_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: request => this.pushResponse(request),
        }),
        connection.fetch.register({
          path: USER_DATA_SYNC_LIST_PATH,
          methods: ['GET', 'HEAD'],
          requestBody: 'buffered',
          fetch: request => this.listResponse(request),
        }),
        connection.fetch.register({
          path: USER_DATA_SYNC_BUNDLE_PATH,
          methods: ['GET', 'HEAD'],
          requestBody: 'buffered',
          fetch: request => this.bundleResponse(request),
        }),
      ]
      return () => {
        for (const dispose of disposers) void dispose()
      }
    })
  }

  /** Active profile facts the routes read on every request. */
  get activeProfile(): UserDataContext {
    const profile = this.ctx.get('profileContext') as ProfileLike | undefined
    if (profile === undefined) throw new Error('user-data-backup requires profileContext')
    return { profile: profile.name, home: profile.home, profileDir: profile.dir }
  }

  private get settings(): SettingsLike | undefined {
    return this.ctx.get('settings')
  }

  /**
   * Assemble the selected components into a ZIP bundle.
   * @param selection Components to include.
   * @param now Timestamp recorded in the manifest and the file name.
   * @returns ZIP bytes, download name and manifest.
   */
  async exportBundle(selection: BundleSelection, now: Date = new Date()): Promise<ExportedBundle> {
    const active = this.activeProfile
    const createdAt = TIMESTAMP_ENCODER(now)
    const settings = selection.components.includes('settings') ? settingsSnapshot(this.settings) : undefined
    const { files, manifest } = await collectBundleFiles({
      profile: active.profile,
      dshVersion: this.dshVersion ?? await packageVersion(),
      createdAt,
      profileDir: active.profileDir,
      home: active.home,
      selection,
      ...settings === undefined ? {} : { settings },
      ...selection.components.includes('sessions') ? { sessionFormatVersion: SESSION_FORMAT_VERSION } : {},
    })
    return { bytes: createBundle(manifest, files), fileName: bundleFileName(active.profile, createdAt), manifest }
  }

  /**
   * Decide what a bundle would change without writing anything.
   * @param bytes Bundle ZIP bytes.
   * @returns Per-component decisions and the settings sections to apply.
   */
  async previewImport(bytes: Uint8Array): Promise<RestorePlan> {
    return planRestore(readBundle(bytes), this.restoreRoots())
  }

  /**
   * Apply a bundle, keeping a timestamped copy of every replaced file.
   * @param bytes Bundle ZIP bytes.
   * @returns The decisions the applied restore carried out.
   */
  async applyImport(bytes: Uint8Array): Promise<RestorePlan> {
    const bundle = readBundle(bytes)
    const plan = await planRestore(bundle, this.restoreRoots())
    await applyRestore(plan, bundle, this.restoreRoots())
    if (plan.settings !== undefined) {
      const settings = this.settings
      if (settings === undefined) throw new Error('bundle carries settings but this deployment has no settings service')
      for (const section of plan.settings.sections) await settings.replace(section.ns, section.values)
    }
    return plan
  }

  private restoreRoots() {
    const active = this.activeProfile
    return {
      profileDir: active.profileDir,
      home: active.home,
      backupRoot: join(active.home, 'backups'),
      sessionFormatVersion: SESSION_FORMAT_VERSION,
      now: new Date().toISOString(),
    }
  }

  private async exportResponse(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const selection = { components: parseComponents(url.searchParams.get('components')) }
    const exported = await this.exportBundle(selection)
    return new Response(new Blob([new Uint8Array(exported.bytes)]), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="' + exported.fileName + '"',
      },
    })
  }

  private async previewResponse(request: Request): Promise<Response> {
    if (request.method === 'GET' || request.method === 'HEAD') return json({ error: 'POST a bundle to preview an import' }, 405)
    return json(await this.previewImport(new Uint8Array(await request.arrayBuffer())))
  }

  private async applyResponse(request: Request): Promise<Response> {
    return json(await this.applyImport(new Uint8Array(await request.arrayBuffer())))
  }

  private remoteOf(request: Request): ConfiguredRemote {
    const id = new URL(request.url).searchParams.get('id')
    if (id === null || id === '') throw new Error('a remote id is required')
    const remote = this.remotes.get(id)
    if (remote === undefined) throw new Error('unknown remote: ' + id)
    return remote
  }

  private remotesResponse(): Response {
    return json([...this.remotes].map(([id, remote]) => ({ id, kind: remote.kind })))
  }

  /**
   * Upload a fresh bundle to a remote and prune what the remote keeps beyond its budget.
   * @param request Push request carrying the remote id and the component selection.
   * @returns Stored name and the pruned names.
   */
  private async pushResponse(request: Request): Promise<Response> {
    const remote = this.remoteOf(request)
    const selection = { components: parseComponents(new URL(request.url).searchParams.get('components')) }
    const exported = await this.exportBundle(selection)
    await remote.target.put(exported.fileName, exported.bytes)
    return json({ name: exported.fileName, pruned: await pruneRemote(remote.target, remote.keep) })
  }

  private async listResponse(request: Request): Promise<Response> {
    return json({ entries: await this.remoteOf(request).target.list() })
  }

  private async bundleResponse(request: Request): Promise<Response> {
    const name = new URL(request.url).searchParams.get('name')
    if (name === null || name === '') throw new Error('a bundle name is required')
    const bytes = await this.remoteOf(request).target.get(name)
    return new Response(new Blob([new Uint8Array(bytes)]), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="' + name.replace(/"/g, '') + '"',
      },
    })
  }
}
