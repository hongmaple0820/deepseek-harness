/** Browser hand-off for one Host download route. */

/**
 * Hand a document-relative Host route to the browser download manager.
 * @param url - document-relative route.
 */
export function downloadRoute(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.click()
}
