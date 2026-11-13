// @vitest-environment jsdom
/** The plugin contributes one settings section and disposes it with its fiber. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

it('registers the data-management section until the plugin is disposed', async () => {
  expect(() => { hostApply() }).not.toThrow()
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)
    const entry = slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'user-data', order: 40 })
    const label = entry.options.label
    expect(typeof label === 'function' ? label() : label).toBe('User data')
    const face = entry.inject!() as { download: (url: string) => void }
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    face.download('/api/user-data.export?components=profile')
    expect(click).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  } finally {
    await ctx.fiber.dispose()
  }
})
