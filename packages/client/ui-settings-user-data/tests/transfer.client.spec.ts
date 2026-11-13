/** Wire helpers address the Host routes and surface refused requests. */
import { expect, it, vi } from 'vitest'
import {
  applyBundle,
  exportUrl,
  fetchRemoteBundle,
  previewBundle,
  pushBundle,
  remoteBundles,
  remoteList,
  type RestorePlan,
} from '../src/client/transfer.ts'

const plan: RestorePlan = {
  components: [{ component: 'profile', added: ['profile/package.json'], replaced: [], skipped: [] }],
  backupDir: '/home/backups/2026-11-13T00:00:00Z',
}

function address(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function recorder(status = 200) {
  const calls: [string, RequestInit | undefined][] = []
  const request: typeof fetch = async (input, init) => {
    calls.push([address(input), init])
    return new Response(JSON.stringify(plan), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, request }
}

it('addresses the export route with the selection in listing order', () => {
  expect(exportUrl(['profile', 'settings'])).toBe('/api/user-data.export?components=profile,settings')
  expect(exportUrl(['sessions'])).toBe('/api/user-data.export?components=sessions')
})

it('previews a bundle without asking the Host to write it', async () => {
  const { calls, request } = recorder()
  const bytes = new Uint8Array([1, 2, 3])
  await expect(previewBundle(bytes, request)).resolves.toEqual(plan)
  expect(calls).toEqual([['/api/user-data.import.preview', { method: 'POST', body: bytes }]])
})

it('applies a bundle through the import route', async () => {
  const { calls, request } = recorder()
  await expect(applyBundle(new Uint8Array([4]), request)).resolves.toEqual(plan)
  expect(calls[0]?.[0]).toBe('/api/user-data.import')
})

it.each([400, 500])('reports a %i answer as an error', async (status) => {
  const { request } = recorder(status)
  const rejected = vi.fn()
  await applyBundle(new Uint8Array(), request).catch(rejected)
  expect(rejected).toHaveBeenCalledWith(new Error(`user-data-backup answered ${status}`))
})

function jsonRecorder(body: unknown, status = 200) {
  const calls: [string, RequestInit | undefined][] = []
  const request: typeof fetch = async (input, init) => {
    calls.push([address(input), init])
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, request }
}

it('lists the configured remotes and their stored bundles', async () => {
  const remotes = jsonRecorder([{ id: 'dav', kind: 'webdav' }])
  await expect(remoteList(remotes.request)).resolves.toEqual([{ id: 'dav', kind: 'webdav' }])
  expect(remotes.calls[0]?.[0]).toBe('/api/user-data.remotes')

  const bundles = jsonRecorder({ entries: [{ name: 'dsh-web-1.zip', size: 4 }] })
  await expect(remoteBundles('dav', bundles.request)).resolves.toEqual([{ name: 'dsh-web-1.zip', size: 4 }])
  expect(bundles.calls[0]?.[0]).toBe('/api/user-data.sync.list?id=dav')
})

it('pushes a selection to one remote', async () => {
  const { calls, request } = jsonRecorder({ name: 'dsh-web-2.zip', pruned: ['dsh-web-1.zip'] })
  await expect(pushBundle('dav', ['profile'], request)).resolves.toEqual({ name: 'dsh-web-2.zip', pruned: ['dsh-web-1.zip'] })
  expect(calls[0]).toEqual(['/api/user-data.sync.push?id=dav&components=profile', { method: 'POST' }])
})

it('downloads one stored bundle', async () => {
  const calls: string[] = []
  const request: typeof fetch = async (input) => {
    calls.push(address(input))
    return new Response(new Uint8Array([7, 8]))
  }
  await expect(fetchRemoteBundle('dav', 'dsh web.zip', request)).resolves.toEqual(new Uint8Array([7, 8]))
  expect(calls).toEqual(['/api/user-data.sync.bundle?id=dav&name=dsh%20web.zip'])
})

it('reports refused remote reads', async () => {
  const { request } = jsonRecorder({ entries: [] }, 404)
  await expect(remoteBundles('dav', request)).rejects.toThrow('user-data-backup answered 404')
  await expect(fetchRemoteBundle('dav', 'x.zip', request)).rejects.toThrow('user-data-backup answered 404')
})
