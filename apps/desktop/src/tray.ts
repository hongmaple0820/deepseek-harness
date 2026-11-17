/** Windows system tray: the always-present way back to a hidden window, the sessions needing attention, and the explicit quit entry. */

import { Menu, nativeImage, Tray } from 'electron'
import type { DesktopAttentionState } from '@deepseek-ai/dsh-client-ui-workspace/types'
import type { DesktopLocale } from './locale.ts'

/** Sessions listed in the tray menu; the rest stay counted in the tooltip and the icon mark. */
export const TRAY_ATTENTION_ROWS = 5

const NO_ATTENTION: DesktopAttentionState = { count: 0, sessions: [] }

/** Main-process actions the tray triggers; each runs the same path as the window and application menu. */
export interface DesktopTrayOptions {
  /** Multi-size ICO rendered by `scripts/render-tray-icon.ts`; Windows picks the bitmap for the display scale. */
  readonly iconPath: string
  /** Variant carrying the attention dot, shown while sessions need attention. */
  readonly attentionIconPath: string
  readonly locale: () => DesktopLocale
  /** Show and focus the primary window. */
  readonly open: () => void
  /** Show and focus the primary window, then open one session in it. */
  readonly openSession: (sessionId: string) => void
  /** Request quit through the same confirmation as every other quit entry. */
  readonly quit: () => void
}

/** Tray icon present for the whole run, not only while the window is hidden. */
export class DesktopTray {
  private tray: Tray | undefined
  private attention: DesktopAttentionState = NO_ATTENTION
  private marked = false

  /** @param options - Icon paths, locale reader, and the open, open-session, and quit actions. */
  constructor(private readonly options: DesktopTrayOptions) {
    const tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray = tray
    tray.on('click', () => { options.open() })
    this.relabel()
  }

  /**
   * Mirror the attention aggregate: swap the icon variant, then relabel tooltip and menu.
   * @param state - complete current aggregate.
   */
  setAttention(state: DesktopAttentionState): void {
    this.attention = state
    this.relabel()
  }

  /** Rebuild the icon, tooltip, and context menu for the current locale and attention state. */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    const { messages } = this.options.locale()
    const state = this.attention
    const marked = state.count > 0
    if (marked !== this.marked) {
      try {
        tray.setImage(nativeImage.createFromPath(marked ? this.options.attentionIconPath : this.options.iconPath))
        this.marked = marked
      } catch (error) { console.warn('desktop tray: attention icon unavailable', error) }
    }
    tray.setToolTip(marked ? messages.attentionTooltip.replace('{count}', String(state.count)) : messages.aboutProduct)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: messages.openApplication, click: () => { this.options.open() } },
      ...this.attentionItems(marked),
      { type: 'separator' },
      { label: messages.quitApplication, click: () => { this.options.quit() } },
    ]))
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }

  private attentionItems(marked: boolean): Electron.MenuItemConstructorOptions[] {
    if (!marked) return []
    const { messages } = this.options.locale()
    const rows = this.attention.sessions.slice(0, TRAY_ATTENTION_ROWS).map(session => ({
      label: session.title,
      click: () => { this.options.openSession(session.sessionId) },
    }))
    return [{ type: 'separator' }, { label: messages.attentionSection, enabled: false }, ...rows]
  }
}
