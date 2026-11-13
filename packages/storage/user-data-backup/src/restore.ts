/**
 * Restore planning and application for a parsed user-data bundle: what would change, and the
 * write that keeps a timestamped copy of every replaced file.
 * @module @deepseek-ai/dsh-user-data-backup/restore
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  BundleError,
  CREDENTIALS_PREFIX,
  PROFILE_PREFIX,
  SESSIONS_PREFIX,
  SETTINGS_PATH,
  type BackupComponent,
  type BundleFile,
  type ParsedBundle,
  type SettingsSnapshot,
} from './bundle.ts'

/** Directories one restore writes into and reads the running format from. */
export interface RestoreRoots {
  /** Profile directory that receives the profile component. */
  readonly profileDir: string
  /** DSH home that receives sessions and credentials. */
  readonly home: string
  /** Directory that keeps the pre-restore copy of every replaced file. */
  readonly backupRoot: string
  /** Session format version this build opens. */
  readonly sessionFormatVersion: number
  /** ISO timestamp naming the pre-restore copy. */
  readonly now: string
}

/** What one component changes. */
export interface ComponentPlan {
  /** Component this plan covers. */
  readonly component: BackupComponent
  /** Target paths the bundle adds. */
  readonly added: readonly string[]
  /** Target paths the bundle overwrites with different bytes. */
  readonly replaced: readonly string[]
  /** Target paths whose bytes already match. */
  readonly skipped: readonly string[]
}

/** Preview of one restore; writing it is a separate step. */
export interface RestorePlan {
  /** Per-component file decisions. */
  readonly components: readonly ComponentPlan[]
  /** Directory that holds the pre-restore copy; created only when a file is replaced. */
  readonly backupDir: string
  /** Settings sections the caller applies through the settings service. */
  readonly settings?: SettingsSnapshot
}

const COMPONENT_PREFIXES: readonly (readonly [BackupComponent, string])[] = [
  ['profile', PROFILE_PREFIX],
  ['sessions', SESSIONS_PREFIX],
  ['credentials', CREDENTIALS_PREFIX],
]

function targetPath(path: string, roots: RestoreRoots): { component: BackupComponent; target: string } {
  /* v8 ignore next -- planRestore removes the settings entry before it plans file targets. */
  if (path === SETTINGS_PATH) throw new BundleError('settings is not a file component')
  for (const [component, prefix] of COMPONENT_PREFIXES) {
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    if (relative === '' || relative.includes('..')) throw new BundleError('bundle path ' + path + ' escapes its component directory')
    const base = component === 'profile' ? roots.profileDir : roots.home
    const head = component === 'profile' ? '' : component
    return { component, target: join(base, head, ...relative.split('/')) }
  }
  throw new BundleError('bundle path ' + path + ' belongs to no component')
}

async function readTarget(target: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

function readSettingsFile(files: readonly BundleFile[]): SettingsSnapshot | undefined {
  const file = files.find(entry => entry.path === SETTINGS_PATH)
  if (file === undefined) return undefined
  return JSON.parse(new TextDecoder().decode(file.data)) as SettingsSnapshot
}

/**
 * Decide what one restore would add, replace and skip without writing anything.
 * @param bundle Parsed bundle to preview.
 * @param roots Directories the restore would target.
 * @returns Per-component decisions, the backup directory name, and the settings snapshot to apply.
 * @throws BundleError when a bundle path escapes its component or the session format is unsupported.
 */
export async function planRestore(bundle: ParsedBundle, roots: RestoreRoots): Promise<RestorePlan> {
  const carriesSessions = bundle.files.some(file => file.path.startsWith(SESSIONS_PREFIX))
  if (carriesSessions && bundle.manifest.sessionFormatVersion !== roots.sessionFormatVersion) {
    throw new BundleError(
      'bundle sessions use format ' + String(bundle.manifest.sessionFormatVersion)
      + '; this build opens ' + String(roots.sessionFormatVersion),
    )
  }
  const decisions = new Map<BackupComponent, { added: string[]; replaced: string[]; skipped: string[] }>()
  for (const file of bundle.files) {
    if (file.path === SETTINGS_PATH) continue
    const { component, target } = targetPath(file.path, roots)
    const entry = decisions.get(component) ?? { added: [], replaced: [], skipped: [] }
    const current = await readTarget(target)
    if (current === undefined) entry.added.push(file.path)
    else if (sameBytes(current, file.data)) entry.skipped.push(file.path)
    else entry.replaced.push(file.path)
    decisions.set(component, entry)
  }
  const components: ComponentPlan[] = []
  for (const [component] of COMPONENT_PREFIXES) {
    const entry = decisions.get(component)
    if (entry === undefined) continue
    components.push({ component, ...entry })
  }
  const settings = readSettingsFile(bundle.files)
  return {
    components,
    backupDir: join(roots.backupRoot, 'import-' + roots.now.replaceAll(':', '-')),
    ...settings === undefined ? {} : { settings },
  }
}

/**
 * Write every added and replaced file, copying replaced ones under the backup directory first.
 * @param plan Preview returned by {@link planRestore}.
 * @param bundle Parsed bundle the plan was made from.
 * @param roots Directories the restore targets.
 */
export async function applyRestore(plan: RestorePlan, bundle: ParsedBundle, roots: RestoreRoots): Promise<void> {
  const byPath = new Map(bundle.files.map(file => [file.path, file.data]))
  for (const component of plan.components) {
    for (const path of component.replaced) {
      const current = await readFile(targetPath(path, roots).target)
      const copy = join(plan.backupDir, ...path.split('/'))
      await mkdir(dirname(copy), { recursive: true })
      await writeFile(copy, current)
    }
  }
  for (const component of plan.components) {
    for (const path of [...component.added, ...component.replaced]) {
      const data = byPath.get(path)
      if (data === undefined) throw new BundleError('plan names ' + path + ' but the bundle does not carry it')
      const { target } = targetPath(path, roots)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
    }
  }
}
