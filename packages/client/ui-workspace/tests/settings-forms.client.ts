/** Shared settings forms for benches whose plugin injects `configForms`. */
import type { Context } from '@deepseek-ai/cordis'
import type { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Script the settings describe with no served namespaces and mount the shared
 * settings forms, so a plugin injecting `configForms` settles without any
 * settings row registering.
 * @param ctx - bench root Context.
 * @param remote - the bench's TestRemote.
 */
export async function mountSettingsForms(ctx: Context, remote: TestRemote): Promise<void> {
  remote.provideNamespaces({ settings: { describe: async () => ({ ok: true as const, value: {
    writable: true, hasDocument: true,
    namespaces: [] as { ns: string; schema: object; value: object; applies: 'live'; secrets: never[]; revision: number }[],
  } }) } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
}
