import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { TRAY_ATTENTION_ROWS, DesktopTray } from '../src/tray.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const trays: FakeTray[] = []
  class FakeTray extends EventEmitter {
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly setImage = vi.fn()
    readonly destroy = vi.fn()
    constructor(readonly image: unknown) { super(); trays.push(this) }
  }
  const menus: MenuItemConstructorOptions[][] = []
  return {
    trays, FakeTray, menus,
    createFromPath: vi.fn((path: string) => ({ path })),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => { menus.push(template); return { template } }),
  }
})
vi.mock('electron', () => ({
  Tray: native.FakeTray,
  nativeImage: { createFromPath: native.createFromPath },
  Menu: { buildFromTemplate: native.buildFromTemplate },
}))

afterEach(() => { native.trays.length = 0; native.menus.length = 0; vi.clearAllMocks() })

function setup(locale = 'en') {
  let current = resolveDesktopLocale(locale)
  const open = vi.fn()
  const openSession = vi.fn()
  const quit = vi.fn()
  const tray = new DesktopTray({
    iconPath: 'C:/app/resources/tray.ico',
    attentionIconPath: 'C:/app/resources/tray-attention.ico',
    locale: () => current,
    open,
    openSession,
    quit,
  })
  return { tray, open, openSession, quit, native: native.trays[0]!, setLocale: (next: string) => { current = resolveDesktopLocale(next) } }
}

function labels(menu: MenuItemConstructorOptions[]): (string | undefined)[] {
  return menu.map(item => item.type === 'separator' ? 'separator' : item.label)
}

it('shows the application icon with its name as the tooltip and an Open / Quit menu', () => {
  const f = setup()
  expect(native.createFromPath).toHaveBeenCalledWith('C:/app/resources/tray.ico')
  expect(f.native.image).toEqual({ path: 'C:/app/resources/tray.ico' })
  expect(f.native.setToolTip).toHaveBeenCalledWith('DeepSeek Harness')
  expect(labels(native.menus[0]!)).toEqual(['Open DeepSeek Harness', 'separator', 'Quit DeepSeek Harness'])
  expect(f.native.setContextMenu).toHaveBeenCalledWith({ template: native.menus[0] })
  expect(f.native.setImage).not.toHaveBeenCalled()
})

it('opens the window on a single click and routes menu entries to the open and quit actions', () => {
  const f = setup()
  f.native.emit('click')
  expect(f.open).toHaveBeenCalledOnce()
  const menu = native.menus[0]!
  ;(menu[0] as { click: () => void }).click()
  ;(menu[2] as { click: () => void }).click()
  expect(f.open).toHaveBeenCalledTimes(2)
  expect(f.quit).toHaveBeenCalledOnce()
})

it('marks the icon, tooltip, and menu with the sessions needing attention', () => {
  const f = setup()
  f.tray.setAttention({
    count: 2,
    sessions: [
      { sessionId: 's1', title: 'Refactor the runner', kind: 'approval' },
      { sessionId: 's2', title: 'Review the proposal', kind: 'completed' },
    ],
  })
  expect(f.native.setImage).toHaveBeenCalledWith({ path: 'C:/app/resources/tray-attention.ico' })
  expect(f.native.setToolTip).toHaveBeenCalledWith('Sessions needing attention: 2')
  expect(labels(native.menus[1]!)).toEqual([
    'Open DeepSeek Harness', 'separator', 'Sessions needing attention',
    'Refactor the runner', 'Review the proposal', 'separator', 'Quit DeepSeek Harness',
  ])
  const menu = native.menus[1]!
  expect(menu[2]).toMatchObject({ enabled: false })
  ;(menu[3] as { click: () => void }).click()
  expect(f.openSession).toHaveBeenCalledWith('s1')
  expect(f.open).not.toHaveBeenCalled()
})

it('caps the listed sessions and reverts the chrome once nothing needs attention', () => {
  const f = setup()
  const sessions = Array.from({ length: TRAY_ATTENTION_ROWS + 3 }, (_, index) => ({
    sessionId: `s${String(index)}`,
    title: `Session ${String(index)}`,
    kind: 'question' as const,
  }))
  f.tray.setAttention({ count: sessions.length, sessions })
  expect(labels(native.menus[1]!)).toHaveLength(1 + 1 + 1 + TRAY_ATTENTION_ROWS + 1 + 1)
  expect(f.native.setToolTip).toHaveBeenCalledWith(`Sessions needing attention: ${String(sessions.length)}`)
  f.tray.setAttention({ count: 0, sessions: [] })
  expect(f.native.setImage).toHaveBeenLastCalledWith({ path: 'C:/app/resources/tray.ico' })
  expect(f.native.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness')
  expect(labels(native.menus[2]!)).toEqual(['Open DeepSeek Harness', 'separator', 'Quit DeepSeek Harness'])
})

it('relabels the menu in the current locale and ignores relabel after disposal', () => {
  const f = setup()
  f.setLocale('zh')
  f.tray.setAttention({ count: 1, sessions: [{ sessionId: 's1', title: '检查会话', kind: 'approval' }] })
  expect(labels(native.menus[1]!)).toEqual(['打开 DeepSeek Harness', 'separator', '需要关注的会话', '检查会话', 'separator', '退出 DeepSeek Harness'])
  f.tray.dispose()
  f.tray.dispose()
  expect(f.native.destroy).toHaveBeenCalledOnce()
  f.tray.relabel()
  expect(native.menus).toHaveLength(2)
})
