/** Background-session attention preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Workspace target; the plugin entry id keys the form. */
export const WORKSPACE_SETTINGS_NAMESPACE = 'ui-workspace'

/** Field carrying the background-notification toggle. */
export const NOTIFICATIONS_FIELD = 'notifications'

/** Workspace preferences projected to the browser. */
export interface WorkspaceSettings {
  /** Whether background session transitions surface OS notifications. */
  notifications: boolean
}

/** Workspace preference fields with their defaults. */
export const WorkspaceSettingsFields = {
  [NOTIFICATIONS_FIELD]: z.boolean().default(true),
}
