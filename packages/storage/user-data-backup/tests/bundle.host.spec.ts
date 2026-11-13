import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUNDLE_SCHEMA_VERSION,
  BundleError,
  MANIFEST_PATH,
  type BundleManifest,
  type SettingsSnapshot,
  bundleFileName,
  collectBundleFiles,
  createBundle,
  readBundle,
} from '../src/bundle.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-data-'))
  roots.push(root)
  return root
}

const snapshot: SettingsSnapshot = {
  sections: [{ ns: 'llm-deepseek', values: { model: 'deepseek-chat' } }],
  secrets: [{ ns: 'llm-deepseek', path: ['apiKey'], set: true }],
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('collecting bundle files', () => {
  it('reads the selected components and records their size facts', async () => {
    const root = await tempRoot()
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), '{"name":"web"}')
    await writeFile(join(profileDir, 'cordis.patch.yml'), 'plugins: []')
    await mkdir(join(root, 'sessions', 's1'), { recursive: true })
    await writeFile(join(root, 'sessions', 's1', 'log.jsonl'), 'line')
    await writeFile(join(root, '.credentials.yaml'), 'token: secret')

    const { files, manifest } = await collectBundleFiles({
      profile: 'web',
      dshVersion: '0.2.2-rc.3',
      createdAt: '2026-11-13T10:00:00.000Z',
      profileDir,
      home: root,
      selection: { components: ['profile', 'settings', 'sessions', 'credentials'] },
      settings: snapshot,
      sessionFormatVersion: 7,
    })

    expect(files.map(file => file.path)).toEqual([
      'profile/package.json',
      'profile/cordis.patch.yml',
      'settings/sections.json',
      'sessions/s1/log.jsonl',
      'credentials/.credentials.yaml',
    ])
    expect(manifest.components.profile).toEqual({ files: 2, bytes: 25, redacted: false })
    expect(manifest.components.settings).toEqual({ files: 1, bytes: 242, redacted: true })
    expect(manifest.components.sessions).toEqual({ files: 1, bytes: 4, redacted: false })
    expect(manifest.components.credentials).toEqual({ files: 1, bytes: 13, redacted: false })
    expect(manifest.sessionFormatVersion).toBe(7)
  })

  it('omits a component file the profile does not have', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'package.json'), '{}')
    const { files, manifest } = await collectBundleFiles({
      profile: 'web',
      dshVersion: '0.2.2-rc.3',
      createdAt: '2026-11-13T10:00:00.000Z',
      profileDir: root,
      home: root,
      selection: { components: ['profile', 'credentials'] },
    })
    expect(files.map(file => file.path)).toEqual(['profile/package.json'])
    expect(manifest.components.credentials).toEqual({ files: 0, bytes: 0, redacted: false })
    expect(manifest.sessionFormatVersion).toBeUndefined()
  })

  it('refuses a settings selection without a snapshot', async () => {
    const root = await tempRoot()
    await expect(collectBundleFiles({
      profile: 'web',
      dshVersion: '0.2.2-rc.3',
      createdAt: '2026-11-13T10:00:00.000Z',
      profileDir: root,
      home: root,
      selection: { components: ['settings'] },
    })).rejects.toThrow(new BundleError('settings selection requires a settings snapshot'))
  })
})

describe('writing and reading a bundle', () => {
  const manifest: BundleManifest = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    createdAt: '2026-11-13T10:00:00.000Z',
    dshVersion: '0.2.2-rc.3',
    profile: 'web',
    components: { profile: { files: 1, bytes: 2, redacted: false } },
  }

  it('round-trips the manifest and the files it describes', () => {
    const bytes = createBundle(manifest, [{ path: 'profile/package.json', data: new TextEncoder().encode('{}') }])
    const parsed = readBundle(bytes)
    expect(parsed.manifest).toEqual(manifest)
    expect(parsed.files.map(file => file.path)).toEqual(['profile/package.json'])
    expect(new TextDecoder().decode(parsed.files[0]!.data)).toBe('{}')
  })

  it('refuses a bundle without a manifest', () => {
    const bytes = createBundle(manifest, [])
    const stripped = readBundle(bytes)
    expect(stripped.files).toEqual([])
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => readBundle(empty)).toThrow(BundleError)
  })

  it('refuses a layout version this build does not implement', () => {
    const bytes = createBundle({ ...manifest, schemaVersion: BUNDLE_SCHEMA_VERSION + 1 }, [])
    expect(() => readBundle(bytes)).toThrow('bundle schema 2 is not supported; this build reads 1')
  })

  it('names a bundle after its profile and timestamp', () => {
    expect(bundleFileName('web', '2026-11-13T10:00:00.000Z')).toBe('dsh-web-2026-11-13T10-00-00.000Z.zip')
    expect(MANIFEST_PATH).toBe('manifest.json')
  })
})

it('carries the lock file and redacts secrets in the composition file', async () => {
  const root = await tempRoot()
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), '{"name":"web"}')
  await writeFile(join(profileDir, 'cordis.patch.yml'), 'plugins:\n  - id: llm\n    config:\n      apiKey: sk-live\n      model: fast\n')
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')

  const { files, manifest } = await collectBundleFiles({
    profile: 'web',
    dshVersion: '0.2.2-rc.3',
    createdAt: '2026-11-13T10:00:00.000Z',
    profileDir,
    home: root,
    selection: { components: ['profile'] },
  })

  expect(files.map(file => file.path)).toEqual([
    'profile/package.json',
    'profile/cordis.patch.yml',
    'profile/pnpm-lock.yaml',
  ])
  const patch = files.find(file => file.path === 'profile/cordis.patch.yml')
  expect(new TextDecoder().decode(patch?.data)).toContain('apiKey: "__DSH_REDACTED__"')
  expect(new TextDecoder().decode(patch?.data)).toContain('model: fast')
  expect(manifest.components.profile?.files).toBe(3)
  expect(manifest.components.profile?.redacted).toBe(true)
})

it('surfaces a profile entry that exists but cannot be read', async () => {
  const root = await tempRoot()
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(join(profileDir, 'package.json'), { recursive: true })
  await expect(collectBundleFiles({
    profile: 'web',
    dshVersion: '0.2.2-rc.3',
    createdAt: '2026-11-13T10:00:00.000Z',
    profileDir,
    home: root,
    selection: { components: ['profile'] },
  })).rejects.toMatchObject({ code: 'EISDIR' })
})
