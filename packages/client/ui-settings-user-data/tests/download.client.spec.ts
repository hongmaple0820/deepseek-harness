// @vitest-environment jsdom
/** The injected download starts a browser navigation the Host answers with a file. */
import { afterEach, expect, it, vi } from 'vitest'
import { downloadRoute } from '../src/client/download.ts'

afterEach(() => { vi.restoreAllMocks() })

it('clicks an anchor that points at the export route', () => {
  const followed: (string | null)[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    followed.push(this.getAttribute('href'))
  })
  downloadRoute('/api/user-data.export?components=profile')
  expect(followed).toEqual(['/api/user-data.export?components=profile'])
})
