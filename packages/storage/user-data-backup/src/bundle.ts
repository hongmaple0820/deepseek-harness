/**
 * Portable user-data bundle: component selection, manifest, ZIP assembly and parsing.
 * @module @deepseek-ai/dsh-user-data-backup/bundle
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { unzipSync, zipSync } from 'fflate'

/** Bundle layout version written into every manifest. */
export const BUNDLE_SCHEMA_VERSION = 1

/** Manifest entry path; the first entry of a written bundle. */
export const MANIFEST_PATH = 'manifest.json'

/** Components a caller may include in a bundle. */
export type BackupComponent = 'profile' | 'settings' | 'sessions' | 'credentials'

/** Component selection for one export. */
export interface BundleSelection {
  /** Components to include; duplicates and unknown names are not expected. */
  readonly components: readonly BackupComponent[]
}

/** Size and redaction facts recorded per included component. */
export interface ComponentSummary {
  /** Number of files the component contributed. */
  readonly files: number
  /** Total uncompressed bytes the component contributed. */
  readonly bytes: number
  /** Whether the component carried a redaction marker instead of secret values. */
  readonly redacted: boolean
}

/** Portable manifest written as the bundle's first entry. */
export interface BundleManifest {
  /** Bundle layout version; readers refuse a version they do not implement. */
  readonly schemaVersion: number
  /** ISO timestamp of the export. */
  readonly createdAt: string
  /** Version of the DSH installation that wrote the bundle. */
  readonly dshVersion: string
  /** Profile the bundle was read from. */
  readonly profile: string
  /** Included components with their size facts. */
  readonly components: Partial<Record<BackupComponent, ComponentSummary>>
  /** Session format version of the sessions the bundle carries, when it carries any. */
  readonly sessionFormatVersion?: number
}

/** One JSON value, spelled out so the module carries no harness dependency. */
export type BundleValue = null | boolean | number | string | BundleValue[] | { [key: string]: BundleValue }

/** One schema-declared secret slot as it appeared when the bundle was written. */
export interface SettingsSecret {
  /** Settings namespace the slot belongs to. */
  readonly ns: string
  /** Path from the section root to the secret slot. */
  readonly path: readonly string[]
  /** Whether the slot held a value; the value itself is never written. */
  readonly set: boolean
}

/** Redacted settings sections taken from the settings service. */
export interface SettingsSnapshot {
  /** Redacted user sections keyed by namespace. */
  readonly sections: readonly { readonly ns: string; readonly values: Record<string, BundleValue> }[]
  /** Every secret slot the redaction removed or blanked. */
  readonly secrets: readonly SettingsSecret[]
}

/** One file carried by a bundle. */
export interface BundleFile {
  /** Bundle-relative path, always forward-slash separated. */
  readonly path: string
  /** File bytes. */
  readonly data: Uint8Array
}

/** Inputs one export reads. */
export interface BundleInput {
  /** Profile name recorded in the manifest. */
  readonly profile: string
  /** Version of the writing installation. */
  readonly dshVersion: string
  /** ISO timestamp recorded in the manifest. */
  readonly createdAt: string
  /** Profile directory holding package.json and the composition patch. */
  readonly profileDir: string
  /** DSH home directory holding sessions and credentials. */
  readonly home: string
  /** Selected components. */
  readonly selection: BundleSelection
  /** Redacted settings snapshot, required when the settings component is selected. */
  readonly settings?: SettingsSnapshot
  /** Session format version, required when the sessions component is selected. */
  readonly sessionFormatVersion?: number
}

/** A parsed bundle: its manifest and every file it carries. */
export interface ParsedBundle {
  /** Manifest read from the bundle's first entry. */
  readonly manifest: BundleManifest
  /** Files other than the manifest. */
  readonly files: readonly BundleFile[]
}

/** Failure raised for an unreadable, unsupported or incomplete bundle. */
export class BundleError extends Error {
  /** Stable failure code callers may report. */
  readonly code = 'USER_DATA_BUNDLE_INVALID'

  /** @param message What makes the bundle unusable. */
  constructor(message: string) {
    super(message)
    this.name = 'BundleError'
  }
}

const PROFILE_FILES = ['package.json', 'cordis.patch.yml'] as const
const CREDENTIALS_FILE = '.credentials.yaml'

/** Directory of the profile component inside a bundle. */
export const PROFILE_PREFIX = 'profile/'
/** Directory of the settings component inside a bundle. */
export const SETTINGS_PREFIX = 'settings/'
/** Redacted settings snapshot inside a bundle. */
export const SETTINGS_PATH = 'settings/sections.json'
/** Directory of the sessions component inside a bundle. */
export const SESSIONS_PREFIX = 'sessions/'
/** Directory of the credentials component inside a bundle. */
export const CREDENTIALS_PREFIX = 'credentials/'

async function readIfPresent(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function walk(root: string, current: string, files: BundleFile[], prefix: string): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) {
      await walk(root, path, files, prefix)
      continue
    }
    files.push({ path: prefix + relative(root, path).split(sep).join('/'), data: await readFile(path) })
  }
}

/**
 * Read the selected components into bundle files and their manifest.
 * @param input Profile, home and selection facts the export reads.
 * @returns Files to write, manifest first, and the manifest describing them.
 */
export async function collectBundleFiles(input: BundleInput): Promise<{ files: BundleFile[]; manifest: BundleManifest }> {
  const files: BundleFile[] = []
  const components: Partial<Record<BackupComponent, ComponentSummary>> = {}
  for (const component of input.selection.components) {
    const start = files.length
    if (component === 'profile') {
      for (const name of PROFILE_FILES) {
        const data = await readIfPresent(join(input.profileDir, name))
        if (data !== undefined) files.push({ path: PROFILE_PREFIX + name, data })
      }
    } else if (component === 'settings') {
      if (input.settings === undefined) throw new BundleError('settings selection requires a settings snapshot')
      files.push({ path: SETTINGS_PATH, data: new TextEncoder().encode(JSON.stringify(input.settings, null, 2)) })
    } else if (component === 'sessions') {
      await walk(join(input.home, 'sessions'), join(input.home, 'sessions'), files, SESSIONS_PREFIX)
    } else {
      const data = await readIfPresent(join(input.home, CREDENTIALS_FILE))
      if (data !== undefined) files.push({ path: CREDENTIALS_PREFIX + CREDENTIALS_FILE, data })
    }
    const added = files.slice(start)
    components[component] = {
      files: added.length,
      bytes: added.reduce((total, file) => total + file.data.byteLength, 0),
      redacted: component === 'settings',
    }
  }
  const manifest: BundleManifest = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    dshVersion: input.dshVersion,
    profile: input.profile,
    components,
    ...input.sessionFormatVersion === undefined ? {} : { sessionFormatVersion: input.sessionFormatVersion },
  }
  return { files, manifest }
}

/**
 * Assemble a ZIP with the manifest as its first entry.
 * @param manifest Manifest describing the bundle.
 * @param files Component files, manifest excluded.
 * @returns ZIP bytes.
 */
export function createBundle(manifest: BundleManifest, files: readonly BundleFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  }
  for (const file of files) entries[file.path] = file.data
  return zipSync(entries, { level: 6, mtime: new Date(manifest.createdAt) })
}

/**
 * Parse a bundle, refusing a layout version this build does not implement.
 * @param bytes ZIP bytes read from a file or a remote target.
 * @returns Manifest and the files it carries.
 */
export function readBundle(bytes: Uint8Array): ParsedBundle {
  const entries = unzipSync(bytes)
  const manifestBytes = entries[MANIFEST_PATH]
  if (manifestBytes === undefined) throw new BundleError('bundle has no ' + MANIFEST_PATH)
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BundleManifest
  if (manifest.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new BundleError('bundle schema ' + String(manifest.schemaVersion) + ' is not supported; this build reads ' + String(BUNDLE_SCHEMA_VERSION))
  }
  const files = Object.entries(entries)
    .filter(([path]) => path !== MANIFEST_PATH)
    .map(([path, data]) => ({ path, data }))
  return { manifest, files }
}

/**
 * Name a download after the profile it came from and the moment it was written.
 * @param profile - profile name recorded in the manifest.
 * @param createdAt - ISO timestamp recorded in the manifest.
 * @returns a ZIP file name without directory components.
 */
export function bundleFileName(profile: string, createdAt: string): string {
  return 'dsh-' + profile + '-' + createdAt.replaceAll(':', '-') + '.zip'
}
