// @vitest-environment jsdom
/** The section previews an import before writing it and reports what changed. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UserDataSection } from '../src/client/UserDataSection.tsx'
import type { RestorePlan } from '../src/client/transfer.ts'
import { en } from '../src/client/locales.ts'

// jsdom has no scrollIntoView; the section brings the form it opens into view.
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView

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
    const path = input.split('?')[0] ?? input
    /* The page reads the remote listing when it mounts; import routes are what these cases watch. */
    if (path === '/api/user-data.remotes') return json([])
    calls.push(path)
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

it('counts the components the export selection carries', () => {
  section()
  expect(screen.getByText(`${en.exportSelected} 2 / 4`)).toBeTruthy()

  fireEvent.click(screen.getByRole('checkbox', { name: en.componentSessions }))
  expect(screen.getByText(`${en.exportSelected} 3 / 4`)).toBeTruthy()
})

it('confirms the download started and drops the note when the selection changes', () => {
  section()
  expect(screen.queryByText(en.exportStarted)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: en.exportAction }))
  expect(screen.getByText(en.exportStarted)).toBeTruthy()

  fireEvent.click(screen.getByRole('checkbox', { name: en.componentSessions }))
  expect(screen.queryByText(en.exportStarted)).toBeNull()
})

it('previews a chosen bundle and applies it only on request', async () => {
  const { calls, file } = bundle()
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })

  await screen.findByText(en.planTitle)
  expect(calls).toEqual(['/api/user-data.import.preview'])
  expect(screen.getByText(`${en.planAdded} 1`)).toBeTruthy()
  expect(screen.getByText(`${en.planReplaced} 1`)).toBeTruthy()
  expect(screen.getByText(`${en.planSkipped} 0`)).toBeTruthy()
  expect(screen.getByText(`${en.planAdded}: profile/package.json`)).toBeTruthy()
  expect(screen.getByText(`${en.planReplaced}: profile/cordis.patch.yml`)).toBeTruthy()
  expect(screen.getByText(`${en.planFile}: dsh-web.zip · 6B`)).toBeTruthy()
  expect(screen.queryByText(new RegExp('^' + en.planOrigin + ':'))).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: en.importApply }))
  await screen.findByText(en.importApplied)
  expect(calls).toEqual(['/api/user-data.import.preview', '/api/user-data.import'])
  expect(screen.getByText(plan.backupDir)).toBeTruthy()
  expect(screen.queryByText(new RegExp('^' + en.importAppliedFrom + ':'))).toBeNull()
  expect(screen.queryByText(en.planTitle)).toBeNull()
})

it('says no bundle is chosen until one is picked', async () => {
  const { file } = bundle()
  section()

  await screen.findByText(en.importEmpty)
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })
  await screen.findByText(en.planTitle)
  expect(screen.queryByText(en.importEmpty)).toBeNull()
})

it('names the size of the bundle it previewed', async () => {
  const { file } = bundle()
  /* A bundle large enough to need a unit: the warning reads as a size, not a byte count. */
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(2048).buffer })
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })

  await screen.findByText(`${en.planFile}: dsh-web.zip · 2.0KB`)
})

it('drops a preview nobody applies', async () => {
  const { calls, file } = bundle()
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })
  await screen.findByText(en.planTitle)

  fireEvent.click(screen.getByRole('button', { name: en.planDismiss }))
  expect(screen.queryByText(en.planTitle)).toBeNull()
  expect(screen.queryByRole('button', { name: en.importApply })).toBeNull()
  expect(calls).toEqual(['/api/user-data.import.preview'])
})

it('reports a refused import and keeps no plan', async () => {
  const { file } = bundle(500)
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(en.importFailed)
  expect(screen.queryByText(en.planTitle)).toBeNull()
  expect(screen.queryByText(en.importEmpty)).toBeNull()
})

it('keeps an import failure when the remote list refreshes', async () => {
  let reads = 0
  routed({
    '/api/user-data.remotes': () => json(reads++ === 0 ? [] : [remote()]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.import.preview': () => json({}, 500),
  })
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), {
    target: { files: [new File(['bundle'], 'dsh-web.zip', { type: 'application/zip' })] },
  })
  await screen.findByRole('alert')

  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText(new RegExp(en.remoteStored))

  /* A refresh only answers the sync card; the import error is not its business. */
  expect(screen.getByRole('alert').textContent).toBe(en.importFailed)
})

interface Routed {
  readonly calls: string[]
  readonly request: typeof fetch
}

function routed(handlers: Record<string, () => Response | Promise<Response>>): Routed {
  const calls: string[] = []
  const request: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    calls.push(url)
    const path = url.split('?')[0] ?? url
    const handler = handlers[path]
    if (handler === undefined) throw new Error('unexpected route ' + url)
    return await handler()
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

it('re-reads the listing when refresh is chosen', async () => {
  let reads = 0
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({
      entries: [{ name: reads++ === 0 ? 'dsh-web-1.zip' : 'dsh-web-9.zip' }],
    }),
  })
  render(<UserDataSection {...sectionProps()} />)
  await screen.findByText('dsh-web-1.zip')

  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  await screen.findByText('dsh-web-9.zip')

  expect(screen.queryByText('dsh-web-1.zip')).toBeNull()
  expect(reads).toBe(2)
})

it('lists the configured remotes with the bundles they store', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({
      entries: [
        { name: 'dsh-web-1.zip', size: 512 },
        { name: 'dsh-web-2.zip', size: 4096 },
        { name: 'dsh-web-3.zip', size: 3 * 1024 * 1024 },
        { name: 'dsh-web-4.zip' },
      ],
    }),
  })
  render(<UserDataSection {...sectionProps()} />)
  await screen.findByText('dsh-web-1.zip')
  expect(screen.getByText(/webdav/)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: en.syncRestore })).toHaveLength(4)
  expect(screen.getByText('512B')).toBeTruthy()
  expect(screen.getByText('4.0KB')).toBeTruthy()
  expect(screen.getByText('3.0MB')).toBeTruthy()
})

it('pushes the current selection and reloads the remote listing', async () => {
  let listed = 0
  const { calls } = routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: listed++ === 0 ? [] : [{ name: 'dsh-web-2.zip' }] }),
    '/api/user-data.sync.push': () => json({ name: 'dsh-web-2.zip', size: 512, pruned: [] }),
  })
  render(<UserDataSection {...sectionProps()} />)
  await screen.findByText(en.syncEmpty)
  fireEvent.click(screen.getByRole('button', { name: en.syncPush }))
  await screen.findByText('dsh-web-2.zip')
  expect(screen.getByText(`${en.syncPushed} · 512B`)).toBeTruthy()
  expect(calls[2]).toBe('/api/user-data.sync.push?id=dav&components=profile,settings')
  expect(calls.filter(url => url === '/api/user-data.sync.list?id=dav')).toHaveLength(2)
})

it('asks before removing a stored remote', async () => {
  const posted: string[] = []
  stubFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (init?.method === 'POST') posted.push(path)
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    return json([remote()])
  })
  section()
  fireEvent.click(await screen.findByRole('button', { name: en.remoteDelete }))
  expect(screen.queryByRole('button', { name: en.remoteTest })).toBeNull()
  expect(screen.getByText(en.remoteDeleteScope)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.remoteCancel }))
  expect(screen.queryByText(en.remoteDeleteScope)).toBeNull()

  expect(posted).toEqual([])
  expect(screen.getByRole('button', { name: en.remoteDelete })).toBeTruthy()
  expect(screen.getByRole('button', { name: en.remoteTest })).toBeTruthy()
})

it('names what a push sends and disables it when nothing is selected', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
  })
  render(<UserDataSection {...sectionProps()} />)
  expect(await screen.findByText(`${en.syncScope}: ${en.componentProfile} / ${en.componentSettings}`)).toBeTruthy()

  fireEvent.click(screen.getByRole('checkbox', { name: en.componentProfile }))
  fireEvent.click(screen.getByRole('checkbox', { name: en.componentSettings }))
  expect(screen.getByText(`${en.syncScope}: ${en.syncScopeNone}`)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.syncPush }).hasAttribute('disabled')).toBe(true)
})

it('restores a stored bundle through the preview pipeline', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-3.zip' }] }),
    '/api/user-data.sync.bundle': () => new Response(new Uint8Array([1])),
    '/api/user-data.import.preview': () => json(plan),
    '/api/user-data.import': () => json(plan),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(await screen.findByRole('button', { name: en.syncRestore }))
  await screen.findByText(en.planTitle)
  expect(screen.getByText(`${en.planAdded}: profile/package.json`)).toBeTruthy()
  expect(screen.getByText(`${en.planOrigin}: dav · dsh-web-3.zip · 1B`)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: en.importApply }))
  await screen.findByText(en.restoreApplied)
  expect(screen.queryByText(en.importApplied)).toBeNull()
  expect(screen.getByText(`${en.importAppliedFrom}: dav · dsh-web-3.zip`)).toBeTruthy()
  expect(screen.getByText(plan.backupDir)).toBeTruthy()
})

it('says when the deployment configures no remote', async () => {
  routed({ '/api/user-data.remotes': () => json([]) })
  render(<UserDataSection {...sectionProps()} />)
  await screen.findByText(en.syncNone)
})

it('offers the add control from the empty state', async () => {
  routed({ '/api/user-data.remotes': () => json([]) })
  section()
  await screen.findByText(en.syncNone)

  /* One add control, inside the hint that says the list is empty — not up in the header. */
  const add = screen.getByRole('button', { name: en.remoteAdd })
  expect(add.closest('[class*="emptyBox"]')).toBeTruthy()
  fireEvent.click(add)
  expect(screen.getByLabelText(en.remoteId)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.remoteAdd })).toBeNull()
})

it('reports a refused remote call', async () => {
  routed({ '/api/user-data.remotes': () => json({}, 503) })
  render(<UserDataSection {...sectionProps()} />)
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
  /* No file is the cancel path, not a refused import: no alert, and the empty hint stays. */
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText(en.importEmpty)).toBeTruthy()
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
  await screen.findByText('dsh-web-1.zip')
  fireEvent.click(screen.getByRole('button', { name: en.syncPush }))
  await screen.findByText(en.syncFailed)
  expect(screen.getByText('dsh-web-1.zip')).toBeTruthy()
})

it('keeps the push receipt when only the listing cannot be read again', async () => {
  let reads = 0
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => {
      reads += 1
      return reads === 1 ? json({ entries: [{ name: 'dsh-web-1.zip' }] }) : json({}, 500)
    },
    '/api/user-data.sync.push': () => json({ name: 'dsh-web-2.zip', size: 512, pruned: ['dsh-web-0.zip'] }),
  })
  render(<UserDataSection {...sectionProps()} />)
  await screen.findByText('dsh-web-1.zip')
  fireEvent.click(screen.getByRole('button', { name: en.syncPush }))

  await screen.findByText(en.syncStale)
  expect(await screen.findByText(`${en.syncPruned} 1`)).toBeTruthy()
  expect(screen.queryByText('dsh-web-2.zip')).toBeNull()
  expect(screen.queryByText(en.syncFailed)).toBeNull()
  expect(screen.getByText('dsh-web-1.zip')).toBeTruthy()
})

it('lists the configured remotes when the page opens', async () => {
  const calls = routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav', source: 'config' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-1.zip' }] }),
  }).calls
  render(<UserDataSection {...sectionProps()} />)

  await screen.findByText('dsh-web-1.zip')
  expect(screen.getByText(new RegExp(en.remoteConfigured))).toBeTruthy()
  expect(screen.getByText(new RegExp('^' + en.syncReadAt + ' \\d{2}:\\d{2}$'))).toBeTruthy()
  expect(calls).toEqual(['/api/user-data.remotes', '/api/user-data.sync.list?id=dav'])
})

it('reports the row whose push is running', async () => {
  let release: (() => void) | undefined
  vi.stubGlobal('fetch', async (input: string) => {
    const path = input.split('?')[0] ?? input
    if (path === '/api/user-data.remotes') return json([remote(), remote({ id: 'nas' })])
    if (path === '/api/user-data.sync.list') return json({ entries: [{ name: 'dsh-web-1.zip' }] })
    if (path === '/api/user-data.sync.push') {
      await new Promise<void>((resolve) => { release = resolve })
      return json({ name: 'dsh-web-2.zip', size: 512, pruned: [] })
    }
    throw new Error('unexpected route ' + input)
  })
  render(<UserDataSection {...sectionProps()} />)

  fireEvent.click((await screen.findAllByRole('button', { name: en.syncPush }))[0]!)
  await screen.findByRole('button', { name: en.syncPushing })

  /* The row that is not uploading keeps its own label. */
  expect(screen.getAllByRole('button', { name: en.syncPush })).toHaveLength(1)

  release?.()
  await waitFor(() => {
    expect(screen.getAllByRole('button', { name: en.syncPush })).toHaveLength(2)
  })
  expect(screen.queryByRole('button', { name: en.syncPushing })).toBeNull()
})

it('says on the row that pushed what the remote dropped', async () => {
  let pushes = 0
  vi.stubGlobal('fetch', async (input: string) => {
    const path = input.split('?')[0] ?? input
    if (path === '/api/user-data.remotes') return json([remote(), remote({ id: 'nas' })])
    if (path === '/api/user-data.sync.list') return json({ entries: [{ name: 'dsh-web-1.zip' }] })
    if (path === '/api/user-data.sync.push') {
      pushes += 1
      return json({
        name: 'dsh-web-2.zip',
        size: 512,
        pruned: pushes === 1 ? ['a.zip', 'b.zip'] : ['a.zip', 'b.zip', 'c.zip'],
      })
    }
    throw new Error('unexpected route ' + input)
  })
  render(<UserDataSection {...sectionProps()} />)

  fireEvent.click((await screen.findAllByRole('button', { name: en.syncPush }))[0]!)
  expect(await screen.findByText(`${en.syncPruned} 2`)).toBeTruthy()

  /* Only the row that pushed reports it; the untouched remote says nothing. */
  expect(screen.getAllByText(new RegExp('^' + en.syncPruned))).toHaveLength(1)

  /* A later push replaces the receipt it left behind. */
  await waitFor(() => {
    expect(screen.getAllByRole('button', { name: en.syncPush })).toHaveLength(2)
  })
  fireEvent.click(screen.getAllByRole('button', { name: en.syncPush })[0]!)
  expect(await screen.findByText(`${en.syncPruned} 3`)).toBeTruthy()
  expect(screen.queryByText(`${en.syncPruned} 2`)).toBeNull()
})

it('moves focus to a preview and back to the choose control', async () => {
  const { file } = bundle()
  render(<UserDataSection {...sectionProps()} />)

  fireEvent.change(screen.getByLabelText(en.importAction), { target: { files: [file] } })
  expect(await screen.findByRole('button', { name: en.planDismiss })).toBe(document.activeElement)

  fireEvent.click(screen.getByRole('button', { name: en.planDismiss }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: en.importAction })).toBe(document.activeElement)
  })
})

it('reports the bundle a row is reading', async () => {
  let release: (() => void) | undefined
  vi.stubGlobal('fetch', async (input: string) => {
    const path = input.split('?')[0] ?? input
    if (path === '/api/user-data.remotes') return json([remote(), remote({ id: 'nas' })])
    if (path === '/api/user-data.sync.list') return json({ entries: [{ name: 'dsh-web-1.zip' }] })
    if (path === '/api/user-data.sync.bundle') {
      await new Promise<void>((resolve) => { release = resolve })
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })
    }
    if (path === '/api/user-data.import.preview') return json(plan)
    throw new Error('unexpected route ' + input)
  })
  render(<UserDataSection {...sectionProps()} />)

  fireEvent.click((await screen.findAllByRole('button', { name: en.syncRestore }))[0]!)
  await screen.findByRole('button', { name: en.syncRestoring })

  /* Only the row that is reading changes its label. */
  expect(screen.getAllByRole('button', { name: en.syncRestore })).toHaveLength(1)

  release?.()
  /* The bytes the row read are counted where they arrived, before the preview replaces them. */
  expect(await screen.findByText('3B / 3B')).toBeTruthy()
  await screen.findByText(en.planTitle)
  expect(screen.queryByRole('button', { name: en.syncRestoring })).toBeNull()
  expect(screen.queryByText('3B / 3B')).toBeNull()
})

function remote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dav', kind: 'webdav', source: 'stored', url: 'https://dav.example.com/dsh', keep: 10,
    secrets: { username: true, password: true, accessKeyId: false, secretAccessKey: false },
    ...overrides,
  }
}

interface Posted {
  readonly path: string
  readonly body: unknown
}

function recording(handlers: Record<string, (body: unknown) => Response | Promise<Response>>): Posted[] {
  const posted: Posted[] = []
  stubFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    const raw = init?.body
    const body: unknown = typeof raw === 'string' ? JSON.parse(raw) : undefined
    const handler = handlers[path]
    if (handler === undefined) throw new Error('unexpected route ' + url)
    if (init?.method === 'POST') posted.push({ path, body })
    return await handler(body)
  })
  return posted
}

it('adds a remote from the form and reloads the listing', async () => {
  /* The mount listing omits the remote the save adds, so the row only appears after the reload. */
  let saved = false
  const posted = recording({
    '/api/user-data.remotes': () => json(saved ? [remote()] : []),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.save': () => {
      saved = true
      return json(remote())
    },
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'dav' } })
  fireEvent.change(screen.getByLabelText(en.remoteUrl), { target: { value: 'https://dav.example.com/dsh' } })
  fireEvent.change(screen.getByLabelText(en.remoteUsername), { target: { value: 'me' } })
  fireEvent.change(screen.getByLabelText(en.remotePassword), { target: { value: 'secret' } })
  fireEvent.change(screen.getByLabelText(en.remotePrefix), { target: { value: 'backups' } })
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))

  await screen.findByText(new RegExp(en.remoteStored))
  expect(posted).toEqual([{
    path: '/api/user-data.remotes.save',
    body: {
      id: 'dav',
      remote: { kind: 'webdav', url: 'https://dav.example.com/dsh', username: 'me', password: 'secret', prefix: 'backups' },
    },
  }])
  expect(screen.queryByRole('button', { name: en.remoteSave })).toBeNull()
})

it('flags an address without a scheme before the save goes out', () => {
  const posted = recording({
    '/api/user-data.remotes': () => json([]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.save': () => json({}, 500),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'dav' } })
  fireEvent.change(screen.getByLabelText(en.remoteUrl), { target: { value: 'dav.example.com/dsh' } })
  expect(screen.getByText(en.remoteUrlInvalid)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.remoteSave }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))

  fireEvent.change(screen.getByLabelText(en.remoteUrl), { target: { value: 'https://dav.example.com/dsh' } })
  expect(screen.queryByText(en.remoteUrlInvalid)).toBeNull()
  expect(screen.getByRole('button', { name: en.remoteSave }).hasAttribute('disabled')).toBe(false)

  fireEvent.change(screen.getByLabelText(en.remoteKind), { target: { value: 's3' } })
  fireEvent.change(screen.getByLabelText(en.remoteEndpoint), { target: { value: 'nas.example.com' } })
  expect(screen.getByText(en.remoteUrlInvalid)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.remoteSave }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))

  /* Neither address reaches the Host, so the recorded list stays empty. */
  expect(posted).toEqual([])
})

it('scrolls the opened form into view inside the panel', () => {
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
})

it('adds an S3 remote once the endpoint names it', async () => {
  /* As above, the listing only holds the remote after the save writes it. */
  let saved = false
  const posted = recording({
    '/api/user-data.remotes': () => json(saved ? [remote({ id: 'bucket', kind: 's3' })] : []),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.save': () => {
      saved = true
      return json(remote({ kind: 's3' }))
    },
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'bucket' } })
  fireEvent.change(screen.getByLabelText(en.remoteKind), { target: { value: 's3' } })
  expect(screen.queryByLabelText(en.remoteUrl)).toBeNull()
  expect(screen.getByRole('button', { name: en.remoteSave }).hasAttribute('disabled')).toBe(true)

  fireEvent.change(screen.getByLabelText(en.remoteEndpoint), { target: { value: 'https://s3.example.com' } })
  fireEvent.change(screen.getByLabelText(en.remoteRegion), { target: { value: 'us-east-1' } })
  fireEvent.change(screen.getByLabelText(en.remoteBucket), { target: { value: 'dsh' } })
  fireEvent.change(screen.getByLabelText(en.remoteAccessKey), { target: { value: 'id' } })
  fireEvent.change(screen.getByLabelText(en.remoteSecretKey), { target: { value: 'key' } })
  fireEvent.change(screen.getByLabelText(en.remoteKeep), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))

  await screen.findByText(new RegExp(en.remoteStored))
  expect(posted[0]?.body).toEqual({
    id: 'bucket',
    remote: {
      kind: 's3', endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'dsh',
      accessKeyId: 'id', secretAccessKey: 'key', keep: 3,
    },
  })
})

it('keeps the form open and reports a refused save', async () => {
  recording({
    '/api/user-data.remotes.save': () => json({}, 500),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'dav' } })
  fireEvent.change(screen.getByLabelText(en.remoteUrl), { target: { value: 'https://dav.example.com/dsh' } })
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))
  await screen.findByText(en.syncFailed)
  expect(screen.getByRole('button', { name: en.remoteSave })).toBeTruthy()
})

it('closes the form without saving', () => {
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.click(screen.getByRole('button', { name: en.remoteCancel }))
  expect(screen.queryByLabelText(en.remoteId)).toBeNull()
})

it('forgets a stored remote and reports the count a probe saw', async () => {
  const posted: string[] = []
  let stored = [remote()]
  stubFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (init?.method === 'POST') posted.push(path)
    if (path === '/api/user-data.remotes.test') return json({ ok: true, entries: 2 })
    if (path === '/api/user-data.remotes.delete') {
      stored = []
      return json({ deleted: 'dav' })
    }
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    return json(stored)
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.remoteTest }))
  expect(await screen.findByText(en.remoteReachable + ' · 2')).toBeTruthy()
  /* The count carries the clock of the moment it was read, so an old count is visible. */
  expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.remoteDelete })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: en.remoteDelete }))
  expect(posted).toEqual(['/api/user-data.remotes.test'])
  fireEvent.click(screen.getByRole('button', { name: en.remoteDeleteConfirm }))
  await screen.findByText(en.syncNone)
  expect(posted).toEqual(['/api/user-data.remotes.test', '/api/user-data.remotes.delete'])
})

it('keeps a stored remote listed when it cannot be removed', async () => {
  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (path === '/api/user-data.remotes.delete') return json({}, 500)
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    return json([remote()])
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.remoteDelete }))
  fireEvent.click(screen.getByRole('button', { name: en.remoteDeleteConfirm }))

  await screen.findByText(en.syncFailed)
  expect(screen.getByText('dav')).toBeTruthy()
})
it('reports the placeholders an imported bundle leaves to fill in', async () => {
  const placeholders: RestorePlan = { ...plan, placeholders: ['profile/cordis.patch.yml: plugins.config.apiKey'] }
  vi.stubGlobal('fetch', async () => json(placeholders))
  section()
  fireEvent.change(screen.getByLabelText(en.importAction), {
    target: { files: [new File(['bundle'], 'dsh-web.zip', { type: 'application/zip' })] },
  })
  await screen.findByText(en.planTitle)
  expect(screen.getByText('profile/cordis.patch.yml: plugins.config.apiKey')).toBeTruthy()
  expect(screen.getByText(en.planPlaceholders)).toBeTruthy()
})

it('reports a remote whose probe was refused', async () => {
  routed({
    '/api/user-data.remotes': () => json([remote()]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.test': () => new Response('broken', { status: 500 }),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.remoteTest }))
  await screen.findByText(en.remoteUnreachable)
})

it('reports a probe that answers without a count', async () => {
  routed({
    '/api/user-data.remotes': () => json([remote()]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.test': () => json({ ok: true }),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.remoteTest }))
  await screen.findByText(en.remoteReachable + ' · 0')
})

it('reports a probe whose transport failed without an error object', async () => {
  routed({
    '/api/user-data.remotes': () => json([remote()]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.test': () => {
      throw 'offline'
    },
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))
  fireEvent.click(await screen.findByRole('button', { name: en.remoteTest }))
  await screen.findByText(en.remoteUnreachable)
})

it('tests every remote from one control', async () => {
  const tested: string[] = []
  stubFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (path === '/api/user-data.remotes.test') {
      const body = JSON.parse(String(init?.body)) as { id: string }
      tested.push(body.id)
      return json({ ok: true, entries: 2 })
    }
    if (path === '/api/user-data.remotes') return json([remote(), remote({ id: 'nas', kind: 's3' })])
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    throw new Error('unexpected route ' + url)
  })
  section()
  fireEvent.click(await screen.findByRole('button', { name: en.syncTestAll }))

  /* One sweep leaves a verdict on every row, in the order the rows are listed. */
  await waitFor(() => expect(screen.getAllByText(en.remoteReachable + ' · 2')).toHaveLength(2))
  expect(tested).toEqual(['dav', 'nas'])
  await waitFor(() => expect(screen.getByRole('button', { name: en.syncTestAll }).hasAttribute('disabled')).toBe(false))
})

it('hides the add control while the form is open so a draft is never thrown away', async () => {
  routed({
    '/api/user-data.remotes': () => json([]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'dav' } })

  /* The typed draft survives: the control that would discard it is gone, and 取消 is the way out. */
  expect(screen.queryByRole('button', { name: en.remoteAdd })).toBeNull()
  expect(screen.getByLabelText<HTMLInputElement>(en.remoteId).value).toBe('dav')
  fireEvent.click(screen.getByRole('button', { name: en.remoteCancel }))
  expect(screen.getByRole('button', { name: en.remoteAdd })).toBeTruthy()
})

it('reports an unreachable Host instead of a refused answer', async () => {
  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    if ((url.split('?')[0] ?? url) === '/api/user-data.remotes') throw new TypeError('fetch failed')
    throw new Error('unexpected route ' + url)
  })
  section()
  expect(await screen.findByText(en.syncUnreachable)).toBeTruthy()
  expect(screen.queryByText(en.syncFailed)).toBeNull()
  expect(screen.queryByText(en.syncLoading)).toBeNull()
  expect(screen.getByRole('button', { name: en.syncRetry })).toBeTruthy()
})

it('re-reads the list from the failure it reports', async () => {
  let reads = 0
  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (path === '/api/user-data.remotes') {
      reads += 1
      if (reads === 1) throw new TypeError('fetch failed')
      return json([remote()])
    }
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    throw new Error('unexpected route ' + url)
  })
  section()
  fireEvent.click(await screen.findByRole('button', { name: en.syncRetry }))

  expect(await screen.findByText('dav')).toBeTruthy()
  expect(screen.queryByText(en.syncUnreachable)).toBeNull()
  expect(reads).toBe(2)
})

it('keeps the rows a failed refresh could not replace', async () => {
  let reads = 0
  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (path === '/api/user-data.remotes') {
      reads += 1
      if (reads > 1) throw new TypeError('fetch failed')
      return json([remote()])
    }
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    throw new Error('unexpected route ' + url)
  })
  section()
  expect(await screen.findByText('dav')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.syncRefresh }))

  /* The row read before the failure stays, and the clock in the header still says when it was read. */
  expect(await screen.findByText(en.syncUnreachable)).toBeTruthy()
  expect(screen.getByText('dav')).toBeTruthy()
  expect(screen.queryByText(en.syncNone)).toBeNull()
  expect(screen.getByText(new RegExp('^' + en.syncReadAt + ' \\d{2}:\\d{2}$'))).toBeTruthy()
})

it('reports a Host that gave up on a slow remote', async () => {
  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    if ((url.split('?')[0] ?? url) === '/api/user-data.remotes') return json({ error: 'timeout' }, 504)
    throw new Error('unexpected route ' + url)
  })
  section()
  expect(await screen.findByText(en.syncTimeout)).toBeTruthy()
  expect(screen.queryByText(en.syncFailed)).toBeNull()
})

it('moves focus into the confirmation and back out of it', async () => {
  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const path = url.split('?')[0] ?? url
    if (path === '/api/user-data.remotes') return json([remote()])
    if (path === '/api/user-data.sync.list') return json({ entries: [] })
    throw new Error('unexpected route ' + url)
  })
  section()
  fireEvent.click(await screen.findByRole('button', { name: en.remoteDelete }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.remoteDeleteConfirm }))

  fireEvent.click(screen.getByRole('button', { name: en.remoteCancel }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.remoteDelete }))
})

it('reports a save failure inside the form that caused it', async () => {
  recording({
    '/api/user-data.remotes.save': () => json({}, 500),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'dav' } })
  fireEvent.change(screen.getByLabelText(en.remoteUrl), { target: { value: 'https://dav.example.com/dsh' } })
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))

  /* One note, inside the form it belongs to, and the form stays open for a second attempt. */
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(en.syncFailed)
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(alert.closest('[class*="editor"]')).toBeTruthy()
  expect(screen.getByRole('button', { name: en.remoteSave })).toBeTruthy()
  /* The retry belongs to the list, not to the form that reported its own failure. */
  expect(screen.queryByRole('button', { name: en.syncRetry })).toBeNull()
})

it('holds the list writes while a save is in flight', async () => {
  let release: (() => void) | undefined
  recording({
    '/api/user-data.remotes': () => json([remote()]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
    '/api/user-data.remotes.save': async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return json(remote({ id: 'dav2' }))
    },
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteId), { target: { value: 'dav2' } })
  fireEvent.change(screen.getByLabelText(en.remoteUrl), { target: { value: 'https://dav.example.com/dsh2' } })
  fireEvent.click(screen.getByRole('button', { name: en.remoteSave }))

  /* A save in flight blocks the calls that would race it. */
  await waitFor(() => {
    expect(screen.getByRole('button', { name: en.remoteSave }).hasAttribute('disabled')).toBe(true)
  })
  expect(screen.getByRole('button', { name: en.syncRefresh }).hasAttribute('disabled')).toBe(true)

  release?.()
  await screen.findByText(new RegExp(en.remoteStored))
  expect(screen.getByRole('button', { name: en.syncRefresh }).hasAttribute('disabled')).toBe(false)
})

it('switches the form back to webdav', () => {
  routed({
    '/api/user-data.remotes': () => json([]),
    '/api/user-data.sync.list': () => json({ entries: [] }),
  })
  section()
  fireEvent.click(screen.getByRole('button', { name: en.remoteAdd }))
  fireEvent.change(screen.getByLabelText(en.remoteKind), { target: { value: 's3' } })
  expect(screen.queryByLabelText(en.remoteUrl)).toBeNull()
  fireEvent.change(screen.getByLabelText(en.remoteKind), { target: { value: 'webdav' } })
  expect(screen.getByLabelText(en.remoteUrl)).toBeTruthy()
})

it('reports a refused remote download', async () => {
  routed({
    '/api/user-data.remotes': () => json([{ id: 'dav', kind: 'webdav' }]),
    '/api/user-data.sync.list': () => json({ entries: [{ name: 'dsh-web-4.zip' }] }),
    '/api/user-data.sync.bundle': () => json({}, 500),
  })
  render(<UserDataSection {...sectionProps()} />)
  fireEvent.click(await screen.findByRole('button', { name: en.syncRestore }))
  await screen.findByText(en.syncFailed)
  expect(screen.queryByText(en.planTitle)).toBeNull()
})
