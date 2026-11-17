/** Host-side settings contract for the workspace attention preferences. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { Config, apply } from '../src/index.ts'

describe('ui-workspace Host settings', () => {
  it('registers, validates, and disposes the attention preferences', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration

    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ inAppAttention: true, notifications: true, taskbarTray: true })
    await configuration.update({ notifications: false })
    expect(plainConfig(configuration.fiber.effectiveConfig))
      .toEqual({ inAppAttention: true, notifications: false, taskbarTray: true })
    await configuration.update({ inAppAttention: false, taskbarTray: false })
    expect(plainConfig(configuration.fiber.effectiveConfig))
      .toEqual({ inAppAttention: false, notifications: false, taskbarTray: false })
    for (const invalid of ['yes', 42, {}]) {
      await expect(configuration.update({ notifications: invalid })).rejects.toThrow()
    }
    // A cleared value falls back to the shipped default rather than rejecting.
    for (const cleared of [null, undefined]) {
      await configuration.update({ notifications: cleared })
      expect((plainConfig(configuration.fiber.effectiveConfig) as { notifications: boolean }).notifications).toBe(true)
    }
    await fiber.dispose()
  })

  it('restores the saved choices', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    await configuration.update({ notifications: false, inAppAttention: false })
    const saved = plainConfig(configuration.fiber.effectiveConfig) as Record<string, unknown>
    await configuration.fiber.dispose()
    const restored = await liveConfig(ctx, { Config, apply }, saved)
    expect(plainConfig(restored.fiber.effectiveConfig))
      .toEqual({ inAppAttention: false, notifications: false, taskbarTray: true })
    await restored.fiber.dispose()
  })

  it('loads without a settings provider', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ Config, apply }).await()).resolves.toBeDefined()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin({ apply })))
