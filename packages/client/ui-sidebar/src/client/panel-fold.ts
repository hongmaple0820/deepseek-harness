/** In-memory fold choice for the global panel navigation. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Fold state of the navigation and its mutations. */
export interface PanelFold {
  /** Whether the navigation renders as its single header row. */
  readonly folded: ObservableSnapshot<boolean>
  /**
   * Fold or expand the navigation.
   * @param folded - Whether the navigation is folded.
   */
  readonly setFolded: (folded: boolean) => void
}

/**
 * Create the in-memory navigation fold state; the snapshot keeps its reference until the state changes.
 * @returns Fold state and the fold mutation.
 */
export function createPanelFold(): PanelFold {
  const store = createSnapshotStore<{ readonly folded: boolean }>({ folded: false })
  return {
    folded: { getSnapshot: () => store.getSnapshot().folded, subscribe: listener => store.subscribe(listener) },
    setFolded: (folded) => {
      if (store.getSnapshot().folded === folded) return
      store.set({ folded })
    },
  }
}
