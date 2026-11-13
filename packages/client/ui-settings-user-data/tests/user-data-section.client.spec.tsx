// @vitest-environment jsdom
/** The section previews an import before writing it and reports what changed. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UserDataSection } from '../src/client/UserDataSection.tsx'
import type { RestorePlan } from '../src/client/transfer.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const plan: RestorePlan = {
  components: [
    { component: 'profile', added: ['profile/package.json'], replaced: ['profile/cordis.patch.yml'], skipped: [] },
  ],
  backupDir: '/home/backups/2026-11-13T10:00:00Z',
}

function sectionProps(download = vi.fn()): ComponentProps<typeof UserDataSection> {
  return { download, t: (key: keyof typeof en) => en[key] } as ComponentProps<typeof UserDataSection>
}

function section(download = vi.fn()) {
  return { download, ...render(<UserDataSection {...sectionProps(download)} />) }
}

function bundle(status = 200) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    calls.push(input)
    return new Response(JSON.stringify(plan), { status, headers: { 'content-type': 'application/json' } })
  })
  return { calls, file: new File(['bundle'], 'dsh-web.zip', { type: 'application/zip' }) }
}

it('downloads the components the user kept selected', () => {
  const { download } = section()
  fireEvent.click(screen.getByRole('button', { name: en.exportAction }))
  expect(download).toHaveBeenLastCalledWith('/api/user-data.export?components=profile,settings')

  fireEvent.click(screen.getByRole('checkbox', { name: en.componentSettings }))
  fireEvent.click(screen.getByRole('button', { name: en.exportAction }))
  expect(download).toHaveBeenLastCalledWith('/api/user-data.export?components=profile')

  fireEvent.click(screen.getByRole('checkbox', { name: en.componentProfile }))
  expect(screen.getByRole('button', { name: en.exportAction }).hasAttribute('disabled')).toBe(true)

  fireEvent.click(screen.getByRole('checkbox', { name: en.componentSettings }))
  fireEvent.click(screen.getByRole('button', { name: en.exportAction }))
  expect(download).toHaveBeenLastCalledWith('/api/user-data.export?components=settings')
})

it('previews a chosen bundle and applies it only on request', async () => {
  const { calls, file } = bundle()
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })

  await screen.findByText(en.planTitle)
  expect(calls).toEqual(['/api/user-data.import.preview'])
  expect(screen.getByText(`${en.planAdded}: profile/package.json`)).toBeTruthy()
  expect(screen.getByText(`${en.planReplaced}: profile/cordis.patch.yml`)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: en.importApply }))
  await screen.findByText(en.importApplied)
  expect(calls).toEqual(['/api/user-data.import.preview', '/api/user-data.import'])
  expect(screen.getByText(plan.backupDir)).toBeTruthy()
  expect(screen.queryByText(en.planTitle)).toBeNull()
})

it('reports a refused import and keeps no plan', async () => {
  const { file } = bundle(500)
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(en.importFailed)
  expect(screen.queryByText(en.planTitle)).toBeNull()
})

interface Routed {
  readonly calls: string[]
  readonly request: typeof fetch
}

function routed(handlers: Record<string, () => Response>): Routed {
  const calls: string[] = []
  const request: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    calls.push(url)
    const path = url.split('?')[0] ?? url
    const handler = handlers[path]
    if (handler === undefined) throw new Error('unexpected route ' + url)
    return handler()
  }
  stubFetch(request)
  return { calls, request }
}

function stubFetch(request: typeof fetch): void {
  vi.stubGlobal('fetch', request)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

it('lists the configured remotes with the bundles they store', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-1.zip' }] }),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText('dsh-web-1.zip')
  expect(screen.getByText('webdav')).toBeTruthy()
  expect(screen.getByRole('button', { name: en.syncRestore })).toBeTruthy()
})

it('pushes the current selection and reloads the remote listing', async () => {
  let listed = 0
  const { calls } = routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: listed++ === 0 ? [] : [{ name: 'dsh-web-2.zip' }] }),
    '/api/user-data.sync.push': () => json({ name: 'dsh-web-2.zip', pruned: [] }),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText(en.syncEmpty)
  fireEvent.click(screen.getByRole('button', { name: en.syncPush }))
  await screen.findByText('dsh-web-2.zip')
  expect(calls[2]).toBe('/api/user-data.sync.push?id=dav&components=profile,settings')
  expect(calls.filter(url => url === '/api/user-data.sync.list?id=dav')).toHaveLength(2)
})

it('restores a stored bundle through the preview pipeline', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-3.zip' }] }),
    '/api/user-data.sync.bundle': () => new Response(new Uint8Array([1])),
    '/api/user-data.import.preview': () => json(plan),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.syncRestore }))
  await screen.findByText(en.planTitle)
  expect(screen.getByText(`${en.planAdded}: profile/package.json`)).toBeTruthy()
})

it('says when the deployment configures no remote', async () => {
  routed({ '/api/user-data.remotes': () => json([]) })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText(en.syncNone)
})

it('reports a refused remote call', async () => {
  routed({ '/api/user-data.remotes': () => json({}, 503) })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText(en.syncFailed)
  expect(screen.queryByText(en.syncNone)).toBeNull()
})

it('opens the file picker from the choose control', () => {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  section()
  fireEvent.click(screen.getByRole('button', { name: en.importAction }))
  expect(click).toHaveBeenCalledTimes(1)
  click.mockRestore()
})

it('ignores a change event that carries no file', () => {
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [] } })
  expect(screen.queryByText(en.planTitle)).toBeNull()
})

it('reports a refused import', async () => {
  vi.stubGlobal('fetch', async () => json({}, 500))
  const file = new File(['bundle'], 'dsh-web.zip', { type: 'application/zip' })
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })
  await screen.findByText(en.importFailed)
})

it('keeps the preview when applying it is refused', async () => {
  const { calls, file } = bundle()
  let previews = 0
  vi.stubGlobal('fetch', async (input: string) => {
    calls.push(input)
    if (input === '/api/user-data.import.preview') {
      previews += 1
      return json(plan)
    }
    return json({}, 500)
  })
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })
  await screen.findByText(en.planTitle)
  fireEvent.click(screen.getByRole('button', { name: en.importApply }))
  await screen.findByText(en.importFailed)
  expect(previews).toBe(1)
  expect(screen.getByText(en.planTitle)).toBeTruthy()
})

it('reports a refused push and keeps the listing', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-1.zip' }] }),
    '/api/user-data.sync.push': () => json({}, 500),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText('dsh-web-1.zip')
  fireEvent.click(screen.getByRole('button', { name: en.syncPush }))
  await screen.findByText(en.syncFailed)
  expect(screen.getByText('dsh-web-1.zip')).toBeTruthy()
})

it('reports a refused remote download', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-4.zip' }] }),
    '/api/user-data.sync.bundle': () => json({}, 500),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.syncRestore }))
  await screen.findByText(en.syncFailed)
  expect(screen.queryByText(en.planTitle)).toBeNull()
})
