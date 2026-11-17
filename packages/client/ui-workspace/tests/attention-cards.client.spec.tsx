// @vitest-environment jsdom
/** Stacked attention cards: the in-app surface of a session transition. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement, type ComponentProps, type ElementType } from 'react'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AttentionStack } from '../src/client/AttentionStack.tsx'
import {
  ApprovalAttentionCard, CompletionAttentionCard, QuestionAttentionCard,
} from '../src/client/AttentionCard.tsx'
import type { AttentionNotice } from '../src/client/contract/attention.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// jsdom has no ResizeObserver; the placement hook only needs an observable stub.
class StubResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', StubResizeObserver)

const t = makeTranslate(en, commonEn) as never
const sid = (id: string): SessionId => id as SessionId

const operations = () => ({
  dismiss: vi.fn(),
  view: vi.fn(),
  allow: vi.fn(async () => {}),
  deny: vi.fn(async () => {}),
})

/**
 * Render a card or stack from the members these cases supply.
 * @param component - surface under test.
 * @param props - the supplied members; the framework seats arrive from the caller.
 */
function renderWith(component: ElementType, props: Record<string, unknown>): void {
  render(createElement(component, props))
}

describe('CompletionAttentionCard', () => {
  it('shows the session, the completion line, and a view action', () => {
    const ops = operations()
    renderWith(CompletionAttentionCard, {
      kind: 'completed', sessionId: sid('s1'), seq: 1, title: 'Refactor the runner', t, ...ops,
    })
    expect(screen.getByText('Refactor the runner')).toBeDefined()
    expect(screen.getByText(en['attention.completed'])).toBeDefined()
    fireEvent.click(screen.getByText(en['attention.view']))
    expect(ops.view).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('labels a failure with the failed status', () => {
    renderWith(CompletionAttentionCard, {
      kind: 'failed', sessionId: sid('s1'), seq: 1, title: 'Broken', t, ...operations(),
    })
    expect(screen.getByText(en['status.failed'])).toBeDefined()
  })

  it('dismisses without opening the session', () => {
    const ops = operations()
    renderWith(CompletionAttentionCard, {
      kind: 'completed', sessionId: sid('s1'), seq: 1, title: 'Done', t, ...ops,
    })
    fireEvent.click(screen.getByLabelText(en['attention.dismiss']))
    expect(ops.dismiss).toHaveBeenCalledExactlyOnceWith('s1')
    expect(ops.view).not.toHaveBeenCalled()
  })
})

describe('ApprovalAttentionCard', () => {
  const notice = {
    kind: 'approval', sessionId: sid('s1'), seq: 1, title: 'Waiting', toolName: 'Edit', reason: 'write the file', answerable: true,
  }

  it('shows the tool, its reason, and the three decisions', () => {
    renderWith(ApprovalAttentionCard, { ...notice, t, ...operations() })
    expect(screen.getByText('Edit')).toBeDefined()
    expect(screen.getByText('write the file')).toBeDefined()
    expect(screen.getByText(en['attention.allow'])).toBeDefined()
    expect(screen.getByText(en['attention.deny'])).toBeDefined()
    expect(screen.getByText(en['attention.view'])).toBeDefined()
  })

  it('allows through the card', async () => {
    const ops = operations()
    renderWith(ApprovalAttentionCard, { ...notice, t, ...ops })
    fireEvent.click(screen.getByText(en['attention.allow']))
    await vi.waitFor(() => { expect(ops.allow).toHaveBeenCalledExactlyOnceWith('s1') })
  })

  it('denies through the card', async () => {
    const ops = operations()
    renderWith(ApprovalAttentionCard, { ...notice, t, ...ops })
    fireEvent.click(screen.getByText(en['attention.deny']))
    await vi.waitFor(() => { expect(ops.deny).toHaveBeenCalledExactlyOnceWith('s1') })
  })

  it('reports a failed delivery and keeps the session reachable', async () => {
    const ops = { ...operations(), allow: vi.fn(async () => { throw new Error('settled') }) }
    renderWith(ApprovalAttentionCard, { ...notice, t, ...ops })
    fireEvent.click(screen.getByText(en['attention.allow']))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(en['attention.view'])).toBeDefined()
  })

  it('offers only the session once the request is no longer answerable', () => {
    renderWith(ApprovalAttentionCard, { ...notice, answerable: false, t, ...operations() })
    expect(screen.queryByText(en['attention.allow'])).toBeNull()
    expect(screen.getByText(en['attention.view'])).toBeDefined()
  })

  it('omits an absent reason', () => {
    renderWith(ApprovalAttentionCard, { ...notice, reason: undefined, t, ...operations() })
    expect(screen.getByText('Edit')).toBeDefined()
  })
})

describe('QuestionAttentionCard', () => {
  it('offers only the session', () => {
    const ops = operations()
    renderWith(QuestionAttentionCard, {
      kind: 'question', sessionId: sid('s1'), seq: 1, title: 'Answer me', t, ...ops,
    })
    expect(screen.getByText(en['status.waitingAnswer'])).toBeDefined()
    expect(screen.queryByText(en['attention.allow'])).toBeNull()
    fireEvent.click(screen.getByText(en['attention.view']))
    expect(ops.view).toHaveBeenCalledExactlyOnceWith('s1')
  })
})

interface StackOverrides {
  notices?: readonly AttentionNotice[]
  focusSidebar?: () => void
}

function stackProps({ notices = [], focusSidebar = vi.fn() }: StackOverrides = {}) {
  const ops = operations()
  const renderSlot = vi.fn((_name: string, owner: { title: string; kind: string }, opts: { entryKey: string }) => (
    <div key={`${owner.kind}:${owner.title}`} data-entry={opts.entryKey}>{owner.title}</div>
  ))
  return {
    props: {
      useAttention: (selector: (value: readonly AttentionNotice[]) => unknown) => selector(notices),
      renderSlot,
      focusSidebar,
      t,
      ...ops,
    },
    ops,
    renderSlot,
  }
}

const noticeOf = (kind: AttentionNotice['kind'], sessionId: string, title: string): AttentionNotice => (
  kind === 'approval'
    ? { kind, sessionId: sid(sessionId), seq: 1, title, toolName: 'Edit', reason: undefined, answerable: true }
    : { kind, sessionId: sid(sessionId), seq: 1, title }
)

describe('AttentionStack', () => {
  it('renders nothing while no session needs attention', () => {
    const { props } = stackProps()
    renderWith(AttentionStack, props)
    expect(document.querySelector('[aria-live="polite"]')).toBeNull()
  })

  it('renders one keyed entry per notice and hands the card operations down', () => {
    const notices = [noticeOf('completed', 's1', 'First'), noticeOf('approval', 's2', 'Second')]
    const { props, renderSlot, ops } = stackProps({ notices })
    renderWith(AttentionStack, props)
    const region = screen.getByRole('region', { name: en['attention.inApp.title'] })
    expect(within(region).getByText('First')).toBeDefined()
    expect(within(region).getByText('Second')).toBeDefined()
    const entry = renderSlot.mock.calls.find(([, , opts]) => opts.entryKey === 'approval')
    expect(entry).toBeDefined()
    expect(entry?.[1]).toMatchObject({
      title: 'Second', dismiss: ops.dismiss, view: ops.view, allow: ops.allow, deny: ops.deny,
    })
  })

  it('shows the newest three cards and one overflow row for the rest', () => {
    const notices = ['s1', 's2', 's3', 's4', 's5'].map((id, index) => noticeOf('completed', id, `Card ${String(index + 1)}`))
    const focusSidebar = vi.fn()
    const { props } = stackProps({ notices, focusSidebar })
    renderWith(AttentionStack, props)
    expect(screen.queryByText('Card 1')).toBeNull()
    expect(screen.getByText('Card 5')).toBeDefined()
    fireEvent.click(screen.getByText(en['attention.moreSessions'].replace('{n}', '2')))
    expect(focusSidebar).toHaveBeenCalledOnce()
  })

  it('hangs above the composer card it measures', () => {
    const card = document.createElement('div')
    card.dataset['composerCard'] = ''
    card.getBoundingClientRect = () => ({ left: 320, top: 600, width: 640, height: 120 }) as DOMRect
    document.body.append(card)
    const { props } = stackProps({ notices: [noticeOf('completed', 's1', 'Placed')] })
    renderWith(AttentionStack, props)
    const region = screen.getByRole('region', { name: en['attention.inApp.title'] })
    // The card top, plus the gap, measured from the viewport bottom.
    expect(region.style.left).toBe('320px')
    expect(region.style.bottom).toBe(`${String(window.innerHeight - 600 + 12)}px`)
    card.remove()
  })
})

/** Re-exported for the type-only contract check. */
export type StackPropsForTest = ComponentProps<typeof AttentionStack>
