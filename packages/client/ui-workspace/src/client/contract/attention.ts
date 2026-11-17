/** In-app session attention: the keyed cards stacked above the composer. */
import type {
  HostObservable, PropsHooks, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { AttentionEventKind } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Fields every attention card carries. */
interface AttentionNoticeFields {
  readonly sessionId: SessionId
  /** Stack position; a higher value is newer. */
  readonly seq: number
  /** Session display title captured when the transition arrived. */
  readonly title: string
}

/** Natural completion or failure of a session the reader was not looking at. */
export interface CompletionAttentionNotice<K extends 'completed' | 'failed' = 'completed' | 'failed'>
  extends AttentionNoticeFields {
  readonly kind: K
}

/** A session waiting for an approval decision. */
export interface ApprovalAttentionNotice extends AttentionNoticeFields {
  readonly kind: 'approval'
  /** Tool that requested the decision. */
  readonly toolName: string
  /** Localized request copy, resolved when the card was raised. */
  readonly reason: string | undefined
  /** False once the request settled elsewhere or cannot be answered inline. */
  readonly answerable: boolean
}

/** A session waiting for an answer. */
export interface QuestionAttentionNotice extends AttentionNoticeFields {
  readonly kind: 'question'
}

/** One stacked notice. */
export type AttentionNotice = CompletionAttentionNotice | ApprovalAttentionNotice | QuestionAttentionNotice

/** Payload of one attention keyed registration. */
export type AttentionNoticeOf<K extends AttentionEventKind> =
  K extends 'completed' | 'failed' ? CompletionAttentionNotice<K>
    : K extends 'approval' ? ApprovalAttentionNotice
      : QuestionAttentionNotice

/** Owner operations shared by every stacked card; the stack supplies them. */
export interface AttentionOwnerProps {
  /** Drop the notice without acting on the session. */
  dismiss(sessionId: SessionId): void
  /** Open the session and drop its notice. */
  view(sessionId: SessionId): void
  /** Answer the session's live approval request. */
  allow(sessionId: SessionId): Promise<void>
  /** Reject the session's live approval request. */
  deny(sessionId: SessionId): Promise<void>
}

/** Complete props of one keyed attention card. */
export type AttentionCardProps<K extends AttentionEventKind> =
  PropsRuntime<'workspace.attention', K> & PropsLocale<'workspace'>

/** Stack data the renderer binds to `useAttention`. */
export type AttentionStackHooks = {
  /** Live notices, newest last. */
  attention: HostObservable<readonly AttentionNotice[]>
}

/** Stack operations the plugin closure supplies. */
export interface AttentionStackInjected extends AttentionOwnerProps {
  /** Bring the collapsed sidebar back, where the dismissal state allows it. */
  focusSidebar(): void
  hooks: AttentionStackHooks
}

/** Complete props of the attention stack container. */
export type AttentionStackProps =
  PropsRuntime<'shell.overlay'> & PropsRenderSlots<'workspace.attention'> & PropsLocale<'workspace'>
  & PropsHooks<AttentionStackInjected['hooks']>
  & Pick<AttentionStackInjected, 'focusSidebar' | 'dismiss' | 'view' | 'allow' | 'deny'>

/** Highest number of cards rendered at once; the rest collapse into one row. */
export const ATTENTION_VISIBLE_CARDS = 3

/** How long a completed or failed card stays before it fades out. */
export const ATTENTION_HOLD_MS = 8_000

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session attention cards, one live registration per transition kind. */
    'workspace.attention': {
      kind: 'keyed'
      scope: 'root'
      owner: AttentionOwnerProps
      keyProps: { [K in AttentionEventKind]: AttentionNoticeOf<K> }
    }
  }
}
