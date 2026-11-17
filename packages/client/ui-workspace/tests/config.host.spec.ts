/** Host-side settings contract for the workspace attention preferences. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { Config, apply } from '../src/index.ts'

describe('ui-workspace Host settings', () => {
  it('registers, validates, and disposes the notifications preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration

    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ notifications: true })
    await configuration.update({ notifications: false })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ notifications: false })
    for (const invalid of ['yes', 42, {}]) {
      await expect(configuration.update({ notifications: invalid })).rejects.toThrow()
    }
    // A cleared value falls back to the shipped default rather than rejecting.
    for (const cleared of [null, undefined]) {
      await configuration.update({ notifications: cleared })
      expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ notifications: true })
    }
    await fiber.dispose()
  })

  it('restores the saved choice', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    await configuration.update({ notifications: false })
    const saved = plainConfig(configuration.fiber.effectiveConfig)
    await configuration.fiber.dispose()
    const restored = await liveConfig(ctx, { Config, apply }, saved)
    expect(plainConfig(restored.fiber.effectiveConfig)).toEqual({ notifications: false })
    await restored.fiber.dispose()
  })

  it('loads without a settings provider', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ Config, apply }).await()).resolves.toBeDefined()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin({ apply })))
