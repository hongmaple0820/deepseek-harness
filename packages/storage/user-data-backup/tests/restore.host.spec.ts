import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BundleError, type BundleManifest, type ParsedBundle } from '../src/bundle.ts'
import { applyRestore, planRestore, type RestoreRoots } from '../src/restore.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-data-restore-'))
  roots.push(root)
  return root
}

const manifest: BundleManifest = {
  schemaVersion: 1,
  createdAt: '2026-11-13T10:00:00.000Z',
  dshVersion: '0.2.2-rc.3',
  profile: 'web',
  components: {},
  sessionFormatVersion: 7,
}

function bundleWith(files: readonly { path: string; text: string }[]): ParsedBundle {
  return {
    manifest,
    files: files.map(file => ({ path: file.path, data: new TextEncoder().encode(file.text) })),
  }
}

function restoreRoots(root: string): RestoreRoots {
  return {
    profileDir: join(root, 'profiles', 'web'),
    home: root,
    backupRoot: join(root, 'backups'),
    sessionFormatVersion: 7,
    now: '2026-11-13T10:00:00.000Z',
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('planning a restore', () => {
  it('reports added, replaced and skipped files per component', async () => {
    const root = await tempRoot()
    const rootsForPlan = restoreRoots(root)
    await mkdir(rootsForPlan.profileDir, { recursive: true })
    await writeFile(join(rootsForPlan.profileDir, 'package.json'), 'old')
    await mkdir(join(root, 'sessions', 's1'), { recursive: true })
    await writeFile(join(root, 'sessions', 's1', 'log.jsonl'), 'same')

    const plan = await planRestore(bundleWith([
      { path: 'profile/package.json', text: 'new' },
      { path: 'profile/cordis.patch.yml', text: 'patch' },
      { path: 'sessions/s1/log.jsonl', text: 'same' },
      { path: 'settings/sections.json', text: JSON.stringify({ sections: [], secrets: [] }) },
    ]), rootsForPlan)

    expect(plan.components).toEqual([
      { component: 'profile', added: ['profile/cordis.patch.yml'], replaced: ['profile/package.json'], skipped: [] },
      { component: 'sessions', added: [], replaced: [], skipped: ['sessions/s1/log.jsonl'] },
    ])
    expect(plan.settings).toEqual({ sections: [], secrets: [] })
    expect(plan.backupDir).toBe(join(root, 'backups', 'import-2026-11-13T10-00-00.000Z'))
  })

  it('refuses a path outside its component directory', async () => {
    const root = await tempRoot()
    await expect(planRestore(bundleWith([{ path: 'profile/../escape', text: 'x' }]), restoreRoots(root)))
      .rejects.toThrow(new BundleError('bundle path profile/../escape escapes its component directory'))
  })

  it('refuses a path that belongs to no component', async () => {
    const root = await tempRoot()
    await expect(planRestore(bundleWith([{ path: 'elsewhere/file', text: 'x' }]), restoreRoots(root)))
      .rejects.toThrow(new BundleError('bundle path elsewhere/file belongs to no component'))
  })

  it('refuses sessions written in a format this build does not open', async () => {
    const root = await tempRoot()
    await expect(planRestore(bundleWith([{ path: 'sessions/s1/log.jsonl', text: 'x' }]), { ...restoreRoots(root), sessionFormatVersion: 8 }))
      .rejects.toThrow('bundle sessions use format 7; this build opens 8')
  })

  it('treats a component directory without a name as unusable', async () => {
    const root = await tempRoot()
    await expect(planRestore(bundleWith([{ path: 'sessions/', text: 'x' }]), restoreRoots(root)))
      .rejects.toThrow('bundle path sessions/ escapes its component directory')
  })
})

describe('applying a restore', () => {
  it('writes added and replaced files and copies the replaced ones aside', async () => {
    const root = await tempRoot()
    const rootsForPlan = restoreRoots(root)
    await mkdir(rootsForPlan.profileDir, { recursive: true })
    await writeFile(join(rootsForPlan.profileDir, 'package.json'), 'old')
    const bundle = bundleWith([
      { path: 'profile/package.json', text: 'new' },
      { path: 'sessions/s1/log.jsonl', text: 'fresh' },
    ])
    const plan = await planRestore(bundle, rootsForPlan)
    await applyRestore(plan, bundle, rootsForPlan)

    expect(await readFile(join(rootsForPlan.profileDir, 'package.json'), 'utf8')).toBe('new')
    expect(await readFile(join(root, 'sessions', 's1', 'log.jsonl'), 'utf8')).toBe('fresh')
    expect(await readFile(join(plan.backupDir, 'profile', 'package.json'), 'utf8')).toBe('old')
  })

  it('refuses a plan that names a file the bundle does not carry', async () => {
    const root = await tempRoot()
    const rootsForPlan = restoreRoots(root)
    const bundle = bundleWith([{ path: 'profile/package.json', text: 'new' }])
    const plan = await planRestore(bundle, rootsForPlan)
    await expect(applyRestore(plan, { ...bundle, files: [] }, rootsForPlan))
      .rejects.toThrow(new BundleError('plan names profile/package.json but the bundle does not carry it'))
  })
})

it('surfaces a target that exists but cannot be read', async () => {
  const root = await tempRoot()
  await mkdir(join(root, 'profiles', 'web', 'package.json'), { recursive: true })
  await expect(planRestore(bundleWith([{ path: 'profile/package.json', text: '{"name":"prod"}' }]), restoreRoots(root)))
    .rejects.toMatchObject({ code: 'EISDIR' })
})
