/**
 * Workspace picker plugin, node half. The Host half projects the workspace
 * attention preferences into the settings forms; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration.
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { NOTIFICATIONS_FIELD, WorkspaceSettingsFields, type WorkspaceSettings } from './attention-settings.ts'

export {
  WORKSPACE_SETTINGS_NAMESPACE, type WorkspaceSettings,
} from './attention-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Whether background session transitions surface OS notifications. */
  notifications: Volatile<WorkspaceSettings['notifications']>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [NOTIFICATIONS_FIELD]: WorkspaceSettingsFields[NOTIFICATIONS_FIELD].volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
