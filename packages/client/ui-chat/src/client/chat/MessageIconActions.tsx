// Shared IconActions chrome for user and assistant messages: copy
// live, optional branch wiring, and an optional date-aware clock.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutlineRegular, IconCheckOutlineRegular, IconCopyOutlineRegular, Tooltip, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatViewSlotProps, UserContentAttachment } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { buildMessageClipboard, writeMessageClipboard } from './message-copy.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

/** No attachments: the copy control keeps its plain-text behaviour. */
const NO_ATTACHMENTS: readonly UserContentAttachment[] = []

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /**
   * Attachments of this message. A list containing an image makes the copy
   * action carry the pictures as well, because a `blob:` preview URL means
   * nothing once pasted elsewhere.
   */
  attachments?: readonly UserContentAttachment[] | undefined
  /** Authorized loader that resolves an image attachment to a fetchable URL. */
  loadImage?: MessageImageLoader | undefined
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and branch controls.
   */
  extraActions?: ReactNode
  /**
   * Icon-row Turn-usage trigger (the TurnUsagePanel pill), seated after the
   * branch control at the end of the icon cluster.
   */
  usageAction?: ReactNode
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, branch callback, className.
 * @returns The actions row element.
 */
export function MessageIconActions(props: MessageIconActionsProps) {
  const {
    text, time, clock, onBranch, branchUnavailable = false, className,
    extraActions, usageAction, t,
  } = props
  const day = useCalendarDay()
  const reasonId = useId()
  const { copied, onCopy } = useClipboardCopy(text)
  const attachments = props.attachments ?? NO_ATTACHMENTS
  const carriesImages = attachments.some(attachment => attachment.type === 'image')
  const [richState, setRichState] = useState<'idle' | 'copied' | 'textOnly'>('idle')
  const richTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const richEpoch = useRef(0)
  useEffect(() => () => {
    richEpoch.current += 1
    if (richTimer.current !== null) clearTimeout(richTimer.current)
  }, [])
  const onCopyRich = useCallback(() => {
    if (richState !== 'idle') return
    const epoch = richEpoch.current
    void buildMessageClipboard({ text, attachments, loadImage: props.loadImage })
      .then(async parts => await writeMessageClipboard(parts))
      .then((result) => {
        if (epoch !== richEpoch.current || !result.ok) return
        setRichState(result.textOnly ? 'textOnly' : 'copied')
        richTimer.current = window.setTimeout(() => {
          richTimer.current = null
          setRichState('idle')
        }, 1600)
      })
      .catch(() => {
        // A failed build leaves the control unchanged; the plain-text button path still works.
      })
  }, [attachments, props.loadImage, richState, text])
  const copyLabel = richState === 'copied'
    ? t('copied')
    : richState === 'textOnly' ? t('message.copiedWithoutImages') : carriesImages ? t('message.copyWithAttachments') : t('copy')
  const clockEl = time === undefined ? null : (
    <span className={clock === 'start' ? css.timeStart : css.timeEnd}>
      {formatMessageClock(time, t, day)}
    </span>
  )
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`} data-clock={clock}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : copyLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={copied ? t('copied') : copyLabel}
          onClick={carriesImages ? onCopyRich : onCopy}
        >
          {copied || richState === 'copied' ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
      {extraActions}
      {onBranch !== undefined && (
        <Tooltip label={branchUnavailable ? t('message.branchUnavailable') : t('message.branch')} side="bottom" openOnClick={branchUnavailable}>
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.action}
            aria-label={t('message.branch')}
            aria-disabled={branchUnavailable || undefined}
            aria-describedby={branchUnavailable ? reasonId : undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <IconBranchOutlineRegular />
          </button>
        </Tooltip>
      )}
      {onBranch !== undefined && branchUnavailable && (
        <span id={reasonId} className={css.visuallyHidden}>{t('message.branchUnavailable')}</span>
      )}
      {clock === 'end'
        ? <span className={css.endInfo}>{usageAction}{clockEl}</span>
        : usageAction}
    </div>
  )
}
