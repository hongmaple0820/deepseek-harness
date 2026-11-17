/** Keyed attention-card registrations, one per transition kind. */
import type { Context } from '@deepseek-ai/cordis'
import {
  ApprovalAttentionCard, CompletionAttentionCard, QuestionAttentionCard,
} from './AttentionCard.tsx'

/**
 * Register the shared card presentations against the `workspace.attention`
 * keyed slot; waiting for the declaration keeps this correct whatever order
 * the overlay stack activates in.
 * @param ctx - Workspace plugin context.
 */
export function registerAttentionCards(ctx: Context): void {
  ctx.slots.inject('workspace.attention', function* () {
    yield ctx.slots.register({ name: 'workspace.attention', key: 'completed', locale: 'workspace' }, CompletionAttentionCard)
    yield ctx.slots.register({ name: 'workspace.attention', key: 'failed', locale: 'workspace' }, CompletionAttentionCard)
    yield ctx.slots.register({ name: 'workspace.attention', key: 'approval', locale: 'workspace' }, ApprovalAttentionCard)
    yield ctx.slots.register({ name: 'workspace.attention', key: 'question', locale: 'workspace' }, QuestionAttentionCard)
  })
}
