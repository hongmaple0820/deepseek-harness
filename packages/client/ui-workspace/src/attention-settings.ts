/** Background-session attention preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Workspace target; the plugin entry id keys the form. */
export const WORKSPACE_SETTINGS_NAMESPACE = 'ui-workspace'

/** Field carrying the in-app attention notices toggle. */
export const INAPP_ATTENTION_FIELD = 'inAppAttention'
/** Field carrying the system notifications toggle. */
export const NOTIFICATIONS_FIELD = 'notifications'
/** Field carrying the taskbar/tray marks toggle. */
export const TASKBAR_TRAY_FIELD = 'taskbarTray'

/** Workspace preferences projected to the browser. */
export interface WorkspaceSettings {
  /** Whether in-app attention notices are shown near the composer. */
  inAppAttention: boolean
  /** Whether background session transitions surface OS notifications. */
  notifications: boolean
  /** Whether taskbar/tray/dock reflect aggregate attention state. */
  taskbarTray: boolean
}

/** Workspace preference fields with their defaults. */
export const WorkspaceSettingsFields = {
  [INAPP_ATTENTION_FIELD]: z.boolean().default(true),
  [NOTIFICATIONS_FIELD]: z.boolean().default(true),
  [TASKBAR_TRAY_FIELD]: z.boolean().default(true),
}
