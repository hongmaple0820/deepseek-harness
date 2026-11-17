/** Background-session attention: one OS notification per session, taskbar and dock marks, and both IPC channels. */
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import {
  ATTENTION_OVERLAY_SIZE, DesktopAttentionChrome, DesktopSessionAttention, installAttentionSummary,
  installSessionAttention, overlayBadge,
} from '../src/session-attention.ts'
import type { DesktopAttentionState } from '@deepseek-ai/dsh-client-ui-workspace/types'
import { DESKTOP_IPC } from '../src/ipc.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const notices: Notice[] = []
  class Notice extends EventEmitter {
    static isSupported = vi.fn(() => true)
    show = vi.fn()
    close = vi.fn()
    constructor(readonly options: unknown) { super(); notices.push(this) }
  }
  return {
    notices,
    Notice,
    dock: { bounce: vi.fn(() => 17), cancelBounce: vi.fn(), setBadge: vi.fn() },
    images: vi.fn((path: string) => ({ path, isEmpty: (): boolean => false, resize: vi.fn((size: unknown) => ({ path, size })) })),
  }
})
const electron = vi.hoisted(() => ({
  app: { dock: native.dock },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  nativeImage: { createFromPath: native.images },
  Notification: native.Notice,
}))
vi.mock('electron', () => electron)
let attention: DesktopSessionAttention | undefined
afterEach(() => {
  attention?.dispose()
  native.notices.length = 0
  vi.clearAllMocks()
  native.Notice.isSupported.mockReturnValue(true)
  native.images.mockImplementation((path: string) => ({
    path, isEmpty: (): boolean => false, resize: vi.fn((size: unknown) => ({ path, size })),
  }))
})

/** Taskbar window stand-in: only the members the attention surfaces touch. */
function fakeWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn((_flag: boolean) => {}),
    setOverlayIcon: vi.fn((_icon: unknown, _description: string) => {}),
    webContents: { send: vi.fn((_channel: string, _sessionId: string) => {}) },
  }
}

function setup() {
  const window = fakeWindow()
  const opened: string[] = []
  attention = new DesktopSessionAttention()
  return {
    window,
    opened,
    notify: (sessionId: string) => { attention!.notify(sessionId, 'Session', 'completed', window, (id) => { opened.push(id) }) },
  }
}

it.each(['win32', 'darwin'])('replaces one session notification and reports clicks back: %s', () => {
  const f = setup()
  f.notify('s1')
  f.notify('s1')
  expect(native.notices).toHaveLength(2)
  expect(native.notices[0]!.close).toHaveBeenCalledOnce()
  expect(native.notices[1]!.options).toEqual({ title: 'Session', body: 'completed', silent: true })
  native.notices[1]!.emit('click')
  expect(f.opened).toEqual(['s1'])
  expect(f.window.show).toHaveBeenCalledOnce()
  expect(f.window.focus).toHaveBeenCalledOnce()
  expect(native.notices[1]!.close).toHaveBeenCalledOnce()
  expect(native.notices).toHaveLength(2)
})

it('keeps sessions independent and releases one on clear', () => {
  const f = setup()
  f.notify('s1')
  f.notify('s2')
  expect(native.notices).toHaveLength(2)
  attention!.clear('s1')
  expect(native.notices[0]!.close).toHaveBeenCalledOnce()
  native.notices[1]!.emit('click')
  expect(f.opened).toEqual(['s2'])
})

it('ignores stale clicks and failed notifications drop their notification without throwing', () => {
  const f = setup()
  f.notify('s1')
  const notification = native.notices[0]!
  attention!.clear('s1')
  notification.emit('click')
  expect(f.opened).toEqual([])
  f.notify('s1')
  native.notices[1]!.emit('failed')
  expect(() => { attention!.dispose() }).not.toThrow()
})

it('degrades silently without notification support', () => {
  const f = setup()
  native.Notice.isSupported.mockReturnValue(false)
  f.notify('s1')
  expect(native.notices).toHaveLength(0)
  expect(f.window.flashFrame).not.toHaveBeenCalled()
})

it('registers the notify channel, validates requests, and honors suppression', () => {
  const window = fakeWindow()
  const assertOwner = vi.fn((_event: IpcMainInvokeEvent) => window)
  let suppressed = false
  const channel = new DesktopSessionAttention()
  attention = channel
  const dispose = installSessionAttention(channel, assertOwner, () => suppressed)
  const handler = electron.ipcMain.handle.mock.calls.find(([name]) => name === DESKTOP_IPC.sessionAttentionNotify)![1] as
    (event: IpcMainInvokeEvent, request: unknown) => void
  const event = {} as IpcMainInvokeEvent
  handler(event, { sessionId: 's1', title: 'Session', body: 'completed' })
  expect(native.notices).toHaveLength(1)
  handler(event, { sessionId: 's1', title: 'Session', body: 'completed' })
  expect(native.notices).toHaveLength(2)
  native.notices[1]!.emit('click')
  expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.sessionAttentionClick, 's1')
  for (const invalid of [null, 'x', 42, {}, { sessionId: 1, title: 't', body: 'b' }, { sessionId: 's', title: 't', body: 2 }]) {
    expect(() => { handler(event, invalid) }).toThrow('desktop session attention: invalid notify request')
  }
  suppressed = true
  handler(event, { sessionId: 's2', title: 'Session', body: 'completed' })
  expect(native.notices).toHaveLength(2)
  dispose()
  expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(DESKTOP_IPC.sessionAttentionNotify)
})

const APPROVAL: DesktopAttentionState = {
  count: 1,
  sessions: [{ sessionId: 's1', title: 'Session', kind: 'approval' }],
}
const COMPLETION: DesktopAttentionState = {
  count: 2,
  sessions: [
    { sessionId: 's1', title: 'Session', kind: 'completed' },
    { sessionId: 's2', title: 'Other', kind: 'failed' },
  ],
}

it('marks the Windows taskbar with an overlay badge and flashes only for approvals', () => {
  const window = fakeWindow()
  const chrome = new DesktopAttentionChrome(() => ({ overlay: true }), 'win32')
  chrome.apply(COMPLETION, window, '2 sessions')
  expect(window.setOverlayIcon).toHaveBeenLastCalledWith({ overlay: true }, '2 sessions')
  expect(window.flashFrame).toHaveBeenLastCalledWith(false)
  chrome.apply(APPROVAL, window, '1 session')
  expect(window.flashFrame).toHaveBeenLastCalledWith(true)
  chrome.apply({ count: 0, sessions: [] }, window, '')
  expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
  expect(window.flashFrame).toHaveBeenLastCalledWith(false)
})

it('marks the macOS dock with the count and holds one critical bounce while approvals wait', () => {
  const chrome = new DesktopAttentionChrome(() => null, 'darwin')
  chrome.apply(APPROVAL, fakeWindow(), '1 session')
  expect(native.dock.setBadge).toHaveBeenLastCalledWith('1')
  expect(native.dock.bounce).toHaveBeenCalledWith('critical')
  chrome.apply(APPROVAL, fakeWindow(), '1 session')
  expect(native.dock.bounce).toHaveBeenCalledOnce()
  chrome.apply(COMPLETION, fakeWindow(), '2 sessions')
  expect(native.dock.setBadge).toHaveBeenLastCalledWith('2')
  expect(native.dock.cancelBounce).toHaveBeenCalledWith(17)
  chrome.dispose(undefined)
  expect(native.dock.setBadge).toHaveBeenLastCalledWith('')
})

it('leaves the taskbar and dock untouched on platforms without marks and survives a failed mark', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const window = fakeWindow()
  const chrome = new DesktopAttentionChrome(() => null, 'linux')
  chrome.apply(APPROVAL, window, '1 session')
  expect(window.setOverlayIcon).not.toHaveBeenCalled()
  expect(native.dock.setBadge).not.toHaveBeenCalled()
  window.setOverlayIcon.mockImplementationOnce(() => { throw new Error('no taskbar') })
  const win32 = new DesktopAttentionChrome(() => null, 'win32')
  expect(() => { win32.apply(APPROVAL, window, '1 session') }).not.toThrow()
  win32.dispose(undefined)
  expect(warn).toHaveBeenCalledOnce()
})

it('builds the overlay badge from the application icon and gives up when it cannot be read', () => {
  const badge = overlayBadge('C:/app/resources/icon.png')
  expect(native.images).toHaveBeenCalledWith('C:/app/resources/icon.png')
  expect(badge).toMatchObject({ size: { width: ATTENTION_OVERLAY_SIZE, height: ATTENTION_OVERLAY_SIZE } })
  native.images.mockReturnValueOnce({
    path: 'missing.png',
    isEmpty: (): boolean => true,
    resize: vi.fn((size: unknown) => ({ path: 'missing.png', size })),
  })
  expect(overlayBadge('missing.png')).toBeNull()
})

it('mirrors the pushed aggregate onto the chrome and the tray, and clears both on disposal', () => {
  const window = fakeWindow()
  const chrome = new DesktopAttentionChrome(() => null, 'win32')
  const tray = { setAttention: vi.fn() }
  let suppressed = false
  const dispose = installAttentionSummary(chrome, {
    tray: () => tray,
    describe: state => `${String(state.count)} sessions`,
  }, () => window, () => suppressed)
  const handler = electron.ipcMain.handle.mock.calls.find(([name]) => name === DESKTOP_IPC.sessionAttentionState)![1] as
    (event: IpcMainInvokeEvent, state: unknown) => void
  const event = {} as IpcMainInvokeEvent
  handler(event, APPROVAL)
  expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, '1 sessions')
  expect(tray.setAttention).toHaveBeenLastCalledWith(APPROVAL)
  suppressed = true
  handler(event, COMPLETION)
  expect(tray.setAttention).toHaveBeenCalledOnce()
  for (const invalid of [
    null, 'x', 42, {}, { count: 1 }, { count: 1, sessions: [null] },
    { count: 1, sessions: [{ sessionId: 's', title: 't', kind: 'idle' }] },
    { count: 1, sessions: [{ sessionId: 1, title: 't', kind: 'completed' }] },
  ]) {
    expect(() => { handler(event, invalid) }).toThrow('desktop session attention: invalid attention')
  }
  dispose()
  expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(DESKTOP_IPC.sessionAttentionState)
  expect(tray.setAttention).toHaveBeenLastCalledWith({ count: 0, sessions: [] })
  expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
})
