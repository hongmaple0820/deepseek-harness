/** User-data settings section for exporting and importing this profile's bundle. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { UserDataSection, type UserDataInjected } from './UserDataSection.tsx'
import { downloadRoute } from './download.ts'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Portable user-data bundle copy. */
    'settings.userData': keyof typeof en
  }
}

/** Services used by the browser companion. */
export const inject = ['slots', 'locale']

/**
 * Register the section, its copy, and its download action.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const locale = 'settings.userData'
  const t = ctx.locale.bind(locale)
  ctx.effect(() => ctx.locale.register(locale, { en, zh, ja, es, fr, de, ru, pt }))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'user-data',
    order: 40,
    label: () => t('nav'),
    locale,
    inject: (): UserDataInjected => ({ download: downloadRoute }),
  }, UserDataSection))
}
