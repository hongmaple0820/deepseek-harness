// @vitest-environment jsdom
/** The General Settings group that governs every attention surface. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AttentionSettingsRow } from '../src/client/AttentionSettingsRow.tsx'
import type { WorkspaceSettings } from '../src/attention-settings.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn) as never

interface Overrides {
  value?: WorkspaceSettings | undefined
  status?: 'loading' | 'ready'
  desktop?: boolean
  setEnabled?: (field: keyof WorkspaceSettings, enabled: boolean) => Promise<boolean>
}

function renderRow({ value, status = 'ready', desktop = true, setEnabled = vi.fn(async () => true) }: Overrides = {}) {
  const snapshot = { status, value }
  const props = {
    useAttention: (selector: (state: typeof snapshot) => unknown) => selector(snapshot),
    setEnabled,
    desktop,
    t,
  }
  const result = render(createElement(AttentionSettingsRow, props as never))
  return { ...result, setEnabled }
}

describe('AttentionSettingsRow', () => {
  it('offers the in-app toggle in a browser tab', () => {
    renderRow({ desktop: false, value: { inAppAttention: true, notifications: true, taskbarTray: true } })
    expect(screen.getByRole('switch', { name: en['attention.inApp.title'] })).toBeDefined()
    expect(screen.queryByRole('switch', { name: en['attention.notifications.title'] })).toBeNull()
    expect(screen.queryByRole('switch', { name: en['attention.taskbarTray.title'] })).toBeNull()
  })

  it('offers all three toggles in the desktop shell', () => {
    renderRow({ value: { inAppAttention: true, notifications: true, taskbarTray: true } })
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getByText(en['attention.notifications.description'])).toBeDefined()
  })

  it('reads each toggle from the stored value', () => {
    renderRow({ value: { inAppAttention: false, notifications: true, taskbarTray: false } })
    expect(screen.getByRole('switch', { name: en['attention.inApp.title'] }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: en['attention.notifications.title'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: en['attention.taskbarTray.title'] }).getAttribute('aria-checked')).toBe('false')
  })

  it('treats a missing stored value as on', () => {
    renderRow()
    expect(screen.getAllByRole('switch').map(node => node.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
  })

  it('writes the flipped value for the toggled field', async () => {
    const { setEnabled } = renderRow({ value: { inAppAttention: true, notifications: true, taskbarTray: true } })
    fireEvent.click(screen.getByRole('switch', { name: en['attention.taskbarTray.title'] }))
    await vi.waitFor(() => { expect(setEnabled).toHaveBeenCalledExactlyOnceWith('taskbarTray', false) })
  })

  it('locks the toggles until the form is ready', () => {
    renderRow({ status: 'loading', value: { inAppAttention: true, notifications: true, taskbarTray: true } })
    for (const node of screen.getAllByRole('switch')) expect((node as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports a refused preference and leaves the toggle usable', async () => {
    const setEnabled = vi.fn(async () => false)
    renderRow({ value: { inAppAttention: true, notifications: true, taskbarTray: true }, setEnabled })
    fireEvent.click(screen.getByRole('switch', { name: en['attention.inApp.title'] }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en['attention.inApp.error'])
    await vi.waitFor(() => {
      expect(screen.getByRole('switch', { name: en['attention.inApp.title'] })).toHaveProperty('disabled', false)
    })
  })

  it('reports a failed write as the same per-field error', async () => {
    const setEnabled = vi.fn(async () => { throw new Error('offline') })
    renderRow({ value: { inAppAttention: true, notifications: true, taskbarTray: true }, setEnabled })
    fireEvent.click(screen.getByRole('switch', { name: en['attention.notifications.title'] }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en['attention.notifications.error'])
  })
})
