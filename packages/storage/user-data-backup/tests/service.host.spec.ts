import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import UserDataBackup, {
  USER_DATA_EXPORT_PATH,
  USER_DATA_IMPORT_PATH,
  USER_DATA_IMPORT_PREVIEW_PATH,
  USER_DATA_REMOTES_PATH,
  USER_DATA_SYNC_BUNDLE_PATH,
  USER_DATA_SYNC_LIST_PATH,
  USER_DATA_SYNC_PUSH_PATH,
  createBundle,
  readBundle,
} from '../src/index.ts'

interface Harness {
  readonly context: Context
  readonly root: string
  readonly routed: Map<string, ConnectionFetchRoute>
  readonly replaced: { ns: string; values: object }[]
}

const harnesses: Harness[] = []

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.context.fiber.dispose()
    await rm(harness.root, { recursive: true, force: true })
  }
})

async function mount(
  config: object = { dshVersion: '9.9.9' },
  extras: { readonly settings?: boolean } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-data-'))
  const home = join(root, 'dsh')
  const profileDir = join(home, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), '{"name":"web"}')
  await writeFile(join(profileDir, 'cordis.patch.yml'), 'plugins: []')

  const routed = new Map<string, ConnectionFetchRoute>()
  const replaced: { ns: string; values: object }[] = []
  const context = new Context()
  context.provide('connection', {
    fetch: {
      register: (route: ConnectionFetchRoute) => {
        routed.set(route.path, route)
        return async () => {
          routed.delete(route.path)
        }
      },
    },
  } as never)
  context.provide('profileContext', { name: 'web', home, dir: profileDir } as never)
  if (extras.settings !== false) {
    context.provide('settings', {
      describe: () => [
        { ns: 'ui', autoGenerate: false, schema: {}, value: {}, revision: 1, user: { theme: 'dark' }, applies: 'live', secrets: [{ path: 'apiKey', set: true }] },
        { ns: 'model', autoGenerate: false, schema: {}, value: {}, revision: 1, applies: 'live' },
      ],
      replace: async (ns: string, values: object) => {
        replaced.push({ ns, values })
      },
    } as never)
  }
  await context.plugin(UserDataBackup, config)
  const harness = { context, root, routed, replaced }
  harnesses.push(harness)
  return harness
}

function route(harness: Harness, path: string): ConnectionFetchRoute {
  const registered = harness.routed.get(path)
  if (registered === undefined) throw new Error('route ' + path + ' is not registered')
  return registered
}

describe('user-data-backup routes', () => {
  it('serves a ZIP whose manifest names the selected components', async () => {
    const harness = await mount()
    const response = await route(harness, USER_DATA_EXPORT_PATH).fetch(
      new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH + '?components=profile,settings'),
    )
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="dsh-web-.*\.zip"$/)
    const bundle = readBundle(new Uint8Array(await response.arrayBuffer()))
    expect(bundle.manifest.dshVersion).toBe('9.9.9')
    expect(bundle.manifest.profile).toBe('web')
    expect(Object.keys(bundle.manifest.components).sort()).toEqual(['profile', 'settings'])
    expect(bundle.files.map(file => file.path).sort()).toEqual([
      'profile/cordis.patch.yml',
      'profile/package.json',
      'settings/sections.json',
    ])
  })

  it('refuses components it does not implement', async () => {
    const harness = await mount()
    await expect(route(harness, USER_DATA_EXPORT_PATH).fetch(
      new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH + '?components=desktop'),
    )).rejects.toThrow('unknown backup components: desktop')
  })

  it('previews an import without writing and applies it on request', async () => {
    const harness = await mount()
    const zip = createBundle(
      {
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        dshVersion: '9.9.9',
        profile: 'web',
        components: {
          profile: { files: 1, bytes: 13, redacted: false },
          settings: { files: 1, bytes: 18, redacted: true },
        },
      },
      [
        { path: 'profile/package.json', data: new TextEncoder().encode('{"name":"prod"}') },
        { path: 'settings/sections.json', data: new TextEncoder().encode('{"sections":[{"ns":"ui","values":{"theme":"light"}}],"secrets":[]}') },
      ],
    )

    const preview = await route(harness, USER_DATA_IMPORT_PREVIEW_PATH).fetch(new Request(
      'http://127.0.0.1' + USER_DATA_IMPORT_PREVIEW_PATH,
      { method: 'POST', body: new Uint8Array(zip) },
    ))
    const plan = await preview.json() as { components: { component: string; added: string[]; replaced: string[] }[] }
    expect(plan.components).toHaveLength(1)
    expect(plan.components[0]).toEqual({
      component: 'profile',
      added: [],
      replaced: ['profile/package.json'],
      skipped: [],
    })
    expect(await readFile(join(harness.root, 'dsh', 'profiles', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}')

    const applied = await route(harness, USER_DATA_IMPORT_PATH).fetch(new Request(
      'http://127.0.0.1' + USER_DATA_IMPORT_PATH,
      { method: 'POST', body: new Uint8Array(zip) },
    ))
    expect(applied.status).toBe(200)
    expect(await readFile(join(harness.root, 'dsh', 'profiles', 'web', 'package.json'), 'utf8')).toBe('{"name":"prod"}')
    expect(harness.replaced).toEqual([{ ns: 'ui', values: { theme: 'light' } }])
  })

  it('answers a GET on the preview route with 405', async () => {
    const harness = await mount()
    const response = await route(harness, USER_DATA_IMPORT_PREVIEW_PATH).fetch(
      new Request('http://127.0.0.1' + USER_DATA_IMPORT_PREVIEW_PATH),
    )
    expect(response.status).toBe(405)
  })
})

it('pushes a bundle to the configured remote and prunes beyond its budget', async () => {
  const stored = new Map<string, Uint8Array>()
  stored.set('dsh-web-2026-11-12T00-00-00.000Z.zip', new Uint8Array([1]))
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'PROPFIND') {
      const body = [...stored.keys()].map(name => '<d:response><d:href>/dsh/' + name + '</d:href></d:response>').join('')
      return new Response('<d:multistatus>' + body + '</d:multistatus>')
    }
    const name = input.slice(input.lastIndexOf('/') + 1)
    if (method === 'PUT') {
      stored.set(name, new Uint8Array(init?.body as Uint8Array))
      return new Response(null, { status: 201 })
    }
    if (method === 'DELETE') {
      stored.delete(name)
      return new Response(null, { status: 204 })
    }
    return new Response(new Blob([new Uint8Array(stored.get(name) ?? new Uint8Array())]))
  })
  const harness = await mount({
    dshVersion: '9.9.9',
    remotes: { dav: { kind: 'webdav', url: 'https://dav.example.com/dsh', keep: 1 } },
  })
  const remotes = await route(harness, USER_DATA_REMOTES_PATH).fetch(new Request('http://127.0.0.1' + USER_DATA_REMOTES_PATH))
  expect(await remotes.json()).toEqual([{ id: 'dav', kind: 'webdav' }])

  const pushed = await route(harness, USER_DATA_SYNC_PUSH_PATH).fetch(new Request(
    'http://127.0.0.1' + USER_DATA_SYNC_PUSH_PATH + '?id=dav&components=profile',
    { method: 'POST' },
  ))
  const receipt = await pushed.json() as { name: string; pruned: string[] }
  expect(receipt.name).toMatch(/^dsh-web-.*\.zip$/)
  expect(receipt.pruned).toEqual(['dsh-web-2026-11-12T00-00-00.000Z.zip'])
  expect([...stored.keys()]).toEqual([receipt.name])

  const listed = await route(harness, USER_DATA_SYNC_LIST_PATH).fetch(new Request(
    'http://127.0.0.1' + USER_DATA_SYNC_LIST_PATH + '?id=dav',
  ))
  expect(await listed.json()).toEqual({ entries: [{ name: receipt.name }] })

  const downloaded = await route(harness, USER_DATA_SYNC_BUNDLE_PATH).fetch(new Request(
    'http://127.0.0.1' + USER_DATA_SYNC_BUNDLE_PATH + '?id=dav&name=' + receipt.name,
  ))
  expect(downloaded.headers.get('content-type')).toBe('application/zip')
  const bundle = readBundle(new Uint8Array(await downloaded.arrayBuffer()))
  expect(Object.keys(bundle.manifest.components)).toEqual(['profile'])
  vi.unstubAllGlobals()
})

it('rejects a remote id it does not know', async () => {
  const harness = await mount()
  await expect(route(harness, USER_DATA_SYNC_LIST_PATH).fetch(new Request(
    'http://127.0.0.1' + USER_DATA_SYNC_LIST_PATH + '?id=nope',
  ))).rejects.toThrow('unknown remote: nope')
})

it('falls back to the package version and the default selection', async () => {
  const harness = await mount({})
  const response = await route(harness, USER_DATA_EXPORT_PATH).fetch(new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH))
  const bundle = readBundle(new Uint8Array(await response.arrayBuffer()))
  expect(bundle.manifest.dshVersion).toMatch(/^\d+\.\d+\.\d+/)
  expect(Object.keys(bundle.manifest.components).sort()).toEqual(['profile', 'settings'])
  const snapshot: unknown = JSON.parse(new TextDecoder().decode(bundle.files.find(file => file.path === 'settings/sections.json')!.data))
  expect(snapshot).toEqual({ sections: [{ ns: 'ui', values: { theme: 'dark' } }], secrets: [{ ns: 'ui', path: 'apiKey', set: true }] })
})

it('exports sessions with the format version this build reads', async () => {
  const harness = await mount()
  await mkdir(join(harness.root, 'dsh', 'sessions'), { recursive: true })
  await writeFile(join(harness.root, 'dsh', 'sessions', 's1.jsonl'), '{"seq":1}')
  const response = await route(harness, USER_DATA_EXPORT_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH + '?components=sessions'),
  )
  const bundle = readBundle(new Uint8Array(await response.arrayBuffer()))
  expect(bundle.manifest.sessionFormatVersion).toBeTypeOf('number')
  expect(bundle.files.map(file => file.path)).toEqual(['sessions/s1.jsonl'])
})

it('refuses a remote whose settings are incomplete', async () => {
  await expect(mount({ remotes: { dav: { kind: 'webdav' } } })).rejects.toThrow('remote dav needs url')
  await expect(mount({ remotes: { s3: { kind: 's3', endpoint: 'https://s3.example.com' } } })).rejects.toThrow(
    'remote s3 needs region',
  )
})

it('requires the connection service and the active profile', async () => {
  const routed = new Map<string, ConnectionFetchRoute>()
  const context = new Context()
  context.provide('connection', {
    fetch: {
      register: (entry: ConnectionFetchRoute) => {
        routed.set(entry.path, entry)
        return async () => {}
      },
    },
  } as never)
  await context.plugin(UserDataBackup, {})
  const exportRoute = routed.get(USER_DATA_EXPORT_PATH)!
  await expect(exportRoute.fetch(new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH)))
    .rejects.toThrow('user-data-backup requires profileContext')
  await context.fiber.dispose()
})

it('refuses settings from a bundle when the deployment has no settings service', async () => {
  const harness = await mount({}, { settings: false })
  const zip = createBundle(
    {
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      dshVersion: '9.9.9',
      profile: 'web',
      components: { settings: { files: 1, bytes: 18, redacted: true } },
    },
    [{ path: 'settings/sections.json', data: new TextEncoder().encode('{"sections":[],"secrets":[]}') }],
  )
  await expect(route(harness, USER_DATA_IMPORT_PATH).fetch(new Request(
    'http://127.0.0.1' + USER_DATA_IMPORT_PATH,
    { method: 'POST', body: new Uint8Array(zip) },
  ))).rejects.toThrow('bundle carries settings but this deployment has no settings service')
})

it('requires a remote id and a bundle name', async () => {
  const harness = await mount()
  await expect(route(harness, USER_DATA_SYNC_LIST_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_SYNC_LIST_PATH),
  )).rejects.toThrow('a remote id is required')
  await expect(route(harness, USER_DATA_SYNC_BUNDLE_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_SYNC_BUNDLE_PATH + '?id=dav'),
  )).rejects.toThrow('a bundle name is required')
  const remotes = await route(harness, USER_DATA_REMOTES_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_REMOTES_PATH, { method: 'HEAD' }),
  )
  expect(await remotes.json()).toEqual([])
})

it('treats an empty component list as the default selection', async () => {
  const harness = await mount()
  const response = await route(harness, USER_DATA_EXPORT_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH + '?components='),
  )
  const bundle = readBundle(new Uint8Array(await response.arrayBuffer()))
  expect(Object.keys(bundle.manifest.components).sort()).toEqual(['profile', 'settings'])
})

it('refuses a settings selection when the deployment has no settings service', async () => {
  const harness = await mount({}, { settings: false })
  await expect(route(harness, USER_DATA_EXPORT_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH + '?components=settings,profile'),
  )).rejects.toThrow('settings selection requires a settings snapshot')
  const profileOnly = await route(harness, USER_DATA_EXPORT_PATH).fetch(
    new Request('http://127.0.0.1' + USER_DATA_EXPORT_PATH + '?components=profile'),
  )
  const bundle = readBundle(new Uint8Array(await profileOnly.arrayBuffer()))
  expect(bundle.files.map(file => file.path).sort()).toEqual(['profile/cordis.patch.yml', 'profile/package.json'])
})

it('applies a profile bundle without touching settings', async () => {
  const harness = await mount()
  const zip = createBundle(
    {
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      dshVersion: '9.9.9',
      profile: 'web',
      components: { profile: { files: 1, bytes: 13, redacted: false } },
    },
    [{ path: 'profile/package.json', data: new TextEncoder().encode('{"name":"prod"}') }],
  )
  const applied = await route(harness, USER_DATA_IMPORT_PATH).fetch(new Request(
    'http://127.0.0.1' + USER_DATA_IMPORT_PATH,
    { method: 'POST', body: new Uint8Array(zip) },
  ))
  expect(applied.status).toBe(200)
  expect(harness.replaced).toEqual([])
})

it('accepts remotes that name credentials and a prefix', async () => {
  const harness = await mount({
    remotes: {
      dav: { kind: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p', prefix: 'nested' },
      s3: {
        kind: 's3', endpoint: 'https://s3.example.com', region: 'eu-west-1', bucket: 'bkt',
        accessKeyId: 'a', secretAccessKey: 's', prefix: 'backups',
      },
    },
  })
  const remotes = await route(harness, USER_DATA_REMOTES_PATH).fetch(new Request('http://127.0.0.1' + USER_DATA_REMOTES_PATH))
  expect(await remotes.json()).toEqual([{ id: 'dav', kind: 'webdav' }, { id: 's3', kind: 's3' }])
})
