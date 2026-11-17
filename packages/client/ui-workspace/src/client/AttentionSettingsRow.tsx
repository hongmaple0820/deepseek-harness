/** General Settings rows for the attention preferences group. */
import { useState, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceSettings } from '../attention-settings.ts'
import type { WorkspaceKey } from './locales.ts'
import css from './AttentionSettingsRow.module.css'

/** Accepted setting and writer supplied by the plugin. */
export interface AttentionSettingsRowInjected {
  hooks: { attention: ObservableSnapshot<ConfigFormSnapshot<WorkspaceSettings>> }
  setEnabled(field: keyof WorkspaceSettings, enabled: boolean): Promise<boolean>
  /** Whether the desktop shell provides the OS surfaces these rows govern. */
  desktop: boolean
}

/** Copy keys of one toggle row. */
interface ToggleCopy {
  readonly title: WorkspaceKey
  readonly description: WorkspaceKey
  readonly error: WorkspaceKey
}

const COPY: Record<keyof WorkspaceSettings, ToggleCopy> = {
  inAppAttention: {
    title: 'attention.inApp.title',
    description: 'attention.inApp.description',
    error: 'attention.inApp.error',
  },
  notifications: {
    title: 'attention.notifications.title',
    description: 'attention.notifications.description',
    error: 'attention.notifications.error',
  },
  taskbarTray: {
    title: 'attention.taskbarTray.title',
    description: 'attention.taskbarTray.description',
    error: 'attention.taskbarTray.error',
  },
}

/**
 * Render the attention toggles as a grouped section. The OS-backed toggles are
 * hidden where no desktop bridge exists, because nothing in a browser tab
 * could act on them.
 * @param props - accepted preferences, writers, desktop availability, and localized copy.
 * @returns the General Settings rows.
 */
export function AttentionSettingsRow({ useAttention, setEnabled, desktop, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'workspace'> & InjectFace<AttentionSettingsRowInjected>): ReactNode {
  const attention = useAttention(value => value)
  const [busy, setBusy] = useState<Partial<Record<keyof WorkspaceSettings, boolean>>>({})
  const [failed, setFailed] = useState<Partial<Record<keyof WorkspaceSettings, boolean>>>({})

  const renderToggle = (field: keyof WorkspaceSettings): ReactNode => {
    const copy = COPY[field]
    const value = attention.value?.[field] !== false
    const isBusy = busy[field] === true
    const isFailed = failed[field] === true
    const isReady = attention.status === 'ready'
    return (
      <div key={field} className={css.row}>
        <div>
          <div className={css.title}>{t(copy.title)}</div>
          <div className={css.description}>{t(copy.description)}</div>
          {isFailed && <div role="alert" className={css.error}>{t(copy.error)}</div>}
        </div>
        <Switch
          checked={value}
          disabled={isBusy || !isReady}
          label={t(copy.title)}
          onChange={(next) => {
            setFailed(prev => ({ ...prev, [field]: false }))
            setBusy(prev => ({ ...prev, [field]: true }))
            void setEnabled(field, next).then((accepted) => {
              if (!accepted) setFailed(prev => ({ ...prev, [field]: true }))
            }).catch(() => {
              setFailed(prev => ({ ...prev, [field]: true }))
            }).finally(() => {
              setBusy(prev => ({ ...prev, [field]: false }))
            })
          }}
        />
      </div>
    )
  }

  return (
    <>
      {renderToggle('inAppAttention')}
      {desktop && renderToggle('notifications')}
      {desktop && renderToggle('taskbarTray')}
    </>
  )
}
