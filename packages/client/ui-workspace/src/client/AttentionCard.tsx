/** The keyed attention cards stacked above the composer. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ATTENTION_HOLD_MS, type AttentionCardProps } from './contract/attention.ts'
import css from './AttentionCard.module.css'

/** Header, kind line, and action row shared by every stacked card. */
function CardFrame({ title, kind, closeLabel, onClose, context, actions }: {
  title: string
  kind: string
  closeLabel: string
  onClose: () => void
  context?: ReactNode
  actions: ReactNode
}): ReactNode {
  return (
    <>
      <div className={css.head}>
        <span className={css.title} title={title}>{title}</span>
        <Button
          variant="ghost"
          size="sm"
          className={css.close}
          icon={<IconCloseOutlineRegular />}
          aria-label={closeLabel}
          onClick={onClose}
        />
      </div>
      <div className={css.kind}>{kind}</div>
      {context}
      <div className={css.actions}>{actions}</div>
    </>
  )
}

/**
 * A session that completed or failed while the reader was elsewhere.
 * @param props - keyed card share.
 * @returns the card.
 */
export function CompletionAttentionCard(props: AttentionCardProps<'completed' | 'failed'>): ReactNode {
  const { kind, sessionId, title, t } = props
  return (
    <article className={css.card} data-expiring style={{ '--attention-hold': `${String(ATTENTION_HOLD_MS)}ms` } as CSSProperties}>
      <CardFrame
        title={title}
        kind={kind === 'completed' ? t('attention.completed') : t('status.failed')}
        closeLabel={t('attention.dismiss')}
        onClose={() => { props.dismiss(sessionId) }}
        actions={(
          <Button variant="primary" size="sm" onClick={() => { props.view(sessionId) }}>
            {t('attention.view')}
          </Button>
        )}
      />
    </article>
  )
}

/**
 * A session waiting for an approval decision, with the same inline decisions
 * the approval panel offers.
 * @param props - keyed card share.
 * @returns the card.
 */
export function ApprovalAttentionCard(props: AttentionCardProps<'approval'>): ReactNode {
  const { sessionId, title, toolName, reason, answerable, t } = props
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const answer = (decide: () => Promise<void>): void => {
    setBusy(true)
    setFailed(false)
    void decide().then(
      () => { setBusy(false) },
      () => {
        setBusy(false)
        setFailed(true)
      },
    )
  }
  return (
    <article className={css.card}>
      <CardFrame
        title={title}
        kind={t('status.waitingApproval')}
        closeLabel={t('attention.dismiss')}
        onClose={() => { props.dismiss(sessionId) }}
        context={(
          <div className={css.context}>
            <span className={css.tool}>{toolName}</span>
            {reason !== undefined && <span className={css.reason}>{reason}</span>}
          </div>
        )}
        actions={(
          <>
            <Button variant="primary" size="sm" onClick={() => { props.view(sessionId) }}>
              {t('attention.view')}
            </Button>
            {answerable && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => { answer(() => props.allow(sessionId)) }}
                >
                  {t('attention.allow')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => { answer(() => props.deny(sessionId)) }}
                >
                  {t('attention.deny')}
                </Button>
              </>
            )}
          </>
        )}
      />
      {failed && <div className={css.error} role="alert">{t('attention.quickReplyFailed')}</div>}
    </article>
  )
}

/**
 * A session waiting for an answer. Answers need the full question surface, so
 * the card only offers its session.
 * @param props - keyed card share.
 * @returns the card.
 */
export function QuestionAttentionCard(props: AttentionCardProps<'question'>): ReactNode {
  const { sessionId, title, t } = props
  return (
    <article className={css.card}>
      <CardFrame
        title={title}
        kind={t('status.waitingAnswer')}
        closeLabel={t('attention.dismiss')}
        onClose={() => { props.dismiss(sessionId) }}
        actions={(
          <Button variant="primary" size="sm" onClick={() => { props.view(sessionId) }}>
            {t('attention.view')}
          </Button>
        )}
      />
    </article>
  )
}
