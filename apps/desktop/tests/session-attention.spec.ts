/** Background-session OS notifications: one per session, click-through, and the notify IPC channel. */
import { EventEmitter } from 'node:events'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopSessionAttention, installSessionAttention } from '../src/session-attention.ts'
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
  return { notices, Notice, dock: { bounce: vi.fn(() => 17), cancelBounce: vi.fn() } }
})
const electron = vi.hoisted(() => ({
  app: { dock: native.dock }, ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }, Notification: native.Notice,
}))
vi.mock('electron', () => electron)
let attention: DesktopSessionAttention | undefined
afterEach(() => { attention?.dispose(); native.notices.length = 0; vi.clearAllMocks(); native.Notice.isSupported.mockReturnValue(true) })

function setup(platform: string) {
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: vi.fn(() => false), show: vi.fn(), focus: vi.fn(), flashFrame: vi.fn(),
    webContents: Object.assign(new EventEmitter(), { send: vi.fn() }),
  })
  const opened: string[] = []
  attention = new DesktopSessionAttention(platform)
  return { window, opened, notify: (sessionId: string) => attention!.notify(sessionId, 'Session', 'completed', window as unknown as BrowserWindow, (id) => { opened.push(id) }) }
}

it.each(['win32', 'darwin'])('replaces one session notification and reports clicks back: %s', (platform) => {
  const f = setup(platform)
  f.notify('s1')
  f.notify('s1')
  expect(native.notices).toHaveLength(2)
  expect(native.notices[0]!.close).toHaveBeenCalledOnce()
  expect(native.notices[1]!.options).toEqual({ title: 'Session', body: 'completed', silent: true })
  if (platform === 'win32') expect(f.window.flashFrame).toHaveBeenCalledWith(true)
  else expect(native.dock.bounce).toHaveBeenCalledWith('informational')
  native.notices[1]!.emit('click')
  expect(f.opened).toEqual(['s1'])
  expect(f.window.show).toHaveBeenCalledOnce()
  expect(f.window.focus).toHaveBeenCalledOnce()
  expect(native.notices[1]!.close).toHaveBeenCalledOnce()
  expect(native.notices).toHaveLength(2)
})

it('keeps sessions independent and releases taskbar attention on clear', () => {
  const f = setup('win32')
  f.notify('s1')
  f.notify('s2')
  expect(native.notices).toHaveLength(2)
  attention!.clear('s1')
  expect(native.notices[0]!.close).toHaveBeenCalledOnce()
  expect(f.window.flashFrame).toHaveBeenLastCalledWith(false)
  native.notices[1]!.emit('click')
  expect(f.opened).toEqual(['s2'])
})

it('ignores stale clicks and failed notifications keep their taskbar attention', () => {
  const f = setup('darwin')
  f.notify('s1')
  const notification = native.notices[0]!
  attention!.clear('s1')
  notification.emit('click')
  expect(f.opened).toEqual([])
  const cancelled = native.dock.cancelBounce.mock.calls.length
  f.notify('s1')
  native.notices[1]!.emit('failed')
  expect(native.dock.cancelBounce.mock.calls.length).toBe(cancelled)
  attention!.dispose()
  expect(native.dock.cancelBounce).toHaveBeenCalledWith(17)
})

it('degrades silently without notification support', () => {
  const f = setup('win32')
  native.Notice.isSupported.mockReturnValue(false)
  f.notify('s1')
  expect(native.notices).toHaveLength(0)
  expect(f.window.flashFrame).not.toHaveBeenCalled()
})

it('registers the notify channel, validates requests, and honors suppression', async () => {
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: vi.fn(() => false), show: vi.fn(), focus: vi.fn(), flashFrame: vi.fn(),
    webContents: Object.assign(new EventEmitter(), { send: vi.fn() }),
  })
  const assertOwner = vi.fn(() => window as unknown as BrowserWindow)
  let suppressed = false
  const channel = new DesktopSessionAttention('win32')
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
    expect(() => handler(event, invalid)).toThrow('desktop session attention: invalid notify request')
  }
  suppressed = true
  handler(event, { sessionId: 's2', title: 'Session', body: 'completed' })
  expect(native.notices).toHaveLength(2)
  dispose()
  expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(DESKTOP_IPC.sessionAttentionNotify)
})
