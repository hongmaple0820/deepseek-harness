/** General Settings row for background-session OS notifications. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceSettings } from '../attention-settings.ts'
import css from './NotificationsRow.module.css'

/** Accepted setting and writer supplied by the plugin. */
export interface NotificationsRowInjected {
  hooks: { notifications: ObservableSnapshot<ConfigFormSnapshot<WorkspaceSettings>> }
  setEnabled(enabled: boolean): Promise<boolean>
}

/**
 * Render the background-notification toggle.
 * @param props - accepted preference, writer and localized copy.
 * @returns the General Settings row.
 */
export function NotificationsRow({ useNotifications, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'workspace'> & InjectFace<NotificationsRowInjected>) {
  const notifications = useNotifications(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('attention.notifications.title')}</div>
      <div className={css.description}>{t('attention.notifications.description')}</div>
      {failed && <div role="alert">{t('attention.notifications.error')}</div>}
    </div>
    <Switch checked={notifications.value?.notifications !== false} disabled={busy || notifications.status !== 'ready'}
      label={t('attention.notifications.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(next).then((accepted) => { if (!accepted) setFailed(true) })
          .catch(() => { setFailed(true) })
          .finally(() => { setBusy(false) })
      }} />
  </div>
}
