/** Stacked in-app attention cards, anchored above the composer card. */
import { Fragment, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ATTENTION_VISIBLE_CARDS, type AttentionStackProps, type AttentionNotice,
} from './contract/attention.ts'
import css from './AttentionStack.module.css'

/** Room between the stack and the composer card it sits above. */
const GAP_PX = 12
/** Inset used when the surface has no composer card to sit above. */
const FALLBACK_INSET_PX = 24

/** Fixed placement of the stack's bottom-left corner, in viewport pixels. */
interface Placement {
  readonly left: number
  readonly bottom: number
}

/**
 * Track the composer card's bottom-left corner. The stack hangs above it, and
 * re-measures on window resizes and composer resizes: the sidebar, right bar,
 * and a growing draft all move the card.
 * @returns the placement, or undefined before the first measurement.
 */
function useComposerPlacement(): Placement {
  const [placement, setPlacement] = useState<Placement>({
    left: FALLBACK_INSET_PX,
    bottom: FALLBACK_INSET_PX,
  })
  useLayoutEffect(() => {
    const card = document.querySelector<HTMLElement>('[data-composer-card]')
    const measure = (): void => {
      const target = card?.isConnected === true ? card : document.querySelector<HTMLElement>('[data-composer-card]')
      if (target === null) {
        setPlacement({ left: FALLBACK_INSET_PX, bottom: FALLBACK_INSET_PX })
        return
      }
      const rect = target.getBoundingClientRect()
      setPlacement({ left: rect.left, bottom: window.innerHeight - rect.top + GAP_PX })
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    if (card !== null) observer.observe(card)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [])
  return placement
}

/** Newest notices nearest the composer, with older ones fanned upward. */
function visibleNotices(notices: readonly AttentionNotice[]): {
  visible: readonly AttentionNotice[]
  hidden: number
} {
  const hidden = Math.max(0, notices.length - ATTENTION_VISIBLE_CARDS)
  return { visible: hidden > 0 ? notices.slice(hidden) : notices, hidden }
}

/**
 * The Workspace shell-overlay container that stacks one card per session
 * needing attention above the composer card.
 * @param props - shell owner share, keyed child slot, locale, and injected notice operations.
 * @returns the stack, or nothing while no session needs attention.
 */
export function AttentionStack(props: AttentionStackProps): ReactNode {
  const notices = props.useAttention(snapshot => snapshot)
  const placement = useComposerPlacement()
  const { visible, hidden } = visibleNotices(notices)
  if (notices.length === 0) return null
  return createPortal(
    <div
      className={css.layer}
      style={{ left: placement.left, bottom: placement.bottom }}
      role="region"
      aria-live="polite"
      aria-label={props.t('attention.inApp.title')}
    >
      {hidden > 0 && (
        <button type="button" className={css.overflow} onClick={props.focusSidebar}>
          {props.t('attention.moreSessions', { n: hidden })}
        </button>
      )}
      {visible.map(notice => (
        <Fragment key={notice.sessionId}>
          {props.renderSlot('workspace.attention', {
            ...notice,
            dismiss: props.dismiss,
            view: props.view,
            allow: props.allow,
            deny: props.deny,
          }, { entryKey: notice.kind })}
        </Fragment>
      ))}
    </div>,
    document.body,
  )
}
