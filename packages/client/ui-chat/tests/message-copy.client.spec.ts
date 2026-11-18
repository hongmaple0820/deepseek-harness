// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UserContentAttachment } from '../src/client/contract/slots.ts'
import {
  buildMessageClipboard,
  formatAttachmentBytes,
  MESSAGE_COPY_IMAGE_LIMIT,
  writeMessageClipboard,
} from '../src/client/chat/message-copy.ts'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71])
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

function fileAttachment(name: string, bytes: number): UserContentAttachment {
  return { type: 'file', file: { attachmentId: 'f1' as never, name, bytes } }
}

function previewImage(url: string, name?: string): UserContentAttachment {
  return { type: 'image', image: { preview: { url, ...name === undefined ? {} : { name } } } }
}

function storedImage(label?: string, bytes = 2048): UserContentAttachment {
  return {
    type: 'image',
    image: {
      attachment: { attachmentId: 'i1' as never, mediaType: 'image/png', bytes, width: 32, height: 16 },
      ...label === undefined ? {} : { label },
    },
  }
}

function blobOf(size: number): Blob {
  const blob = new Blob([PNG_BYTES], { type: 'image/png' })
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

interface ClipboardStub {
  readonly write: ReturnType<typeof vi.fn>
  readonly writeText: ReturnType<typeof vi.fn>
}

function stubNavigator(): ClipboardStub {
  const clipboard = { write: vi.fn(async () => {}), writeText: vi.fn(async () => {}) }
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  return clipboard
}

class FakeClipboardItem {
  readonly items: Record<string, Blob>
  constructor(items: Record<string, Blob>) {
    this.items = items
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blobOf(PNG_BYTES.length) })))
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('formatAttachmentBytes', () => {
  it('renders bytes, kilobytes, and megabytes the way attachment cards do', () => {
    expect(formatAttachmentBytes(820)).toBe('820 B')
    expect(formatAttachmentBytes(12 * 1024)).toBe('12 KB')
    expect(formatAttachmentBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatAttachmentBytes(1.4 * 1024 * 1024)).toBe('1.4 MB')
  })
})

describe('buildMessageClipboard', () => {
  it('keeps a text-only message as its own text', async () => {
    const parts = await buildMessageClipboard({ text: 'hello', attachments: [] })
    expect(parts.plain).toBe('hello')
    expect(parts.html).toBe('<div><p>hello</p></div>')
    expect(parts.image).toBeUndefined()
    expect(parts.mentioned).toBe(0)
    expect(parts.inlined).toBe(0)
  })

  it('lists file attachments with their sizes and keeps the text first', async () => {
    const parts = await buildMessageClipboard({
      text: 'see attached',
      attachments: [fileAttachment('report.xlsx', 1_468_006)],
    })
    expect(parts.plain).toBe('see attached\n- report.xlsx (1.4 MB)')
    expect(parts.html).toContain('see attached')
    expect(parts.html).toContain('- report.xlsx (1.4 MB)')
    expect(parts.mentioned).toBe(1)
    expect(parts.inlined).toBe(0)
  })

  it('escapes HTML in attachment names so the rich flavor stays inert', async () => {
    const parts = await buildMessageClipboard({
      text: '',
      attachments: [fileAttachment('<script>.txt', 12)],
    })
    expect(parts.plain).toBe('- <script>.txt (12 B)')
    expect(parts.html).toContain('&lt;script&gt;.txt')
    expect(parts.html).not.toContain('<script>')
  })

  it('inlines a preview image as a data URL and carries it as the PNG flavor', async () => {
    const readAsDataUrl = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: DATA_URL, configurable: true })
      // The mocked reader hands the handler the load event it would fire.
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
    })
    const parts = await buildMessageClipboard({
      text: 'look',
      attachments: [previewImage('blob:abc', 'shot.png')],
    })
    readAsDataUrl.mockRestore()
    expect(parts.image).toBe(DATA_URL)
    expect(parts.inlined).toBe(1)
    expect(parts.html).toContain(`<img src="${DATA_URL}" alt="shot.png">`)
    expect(parts.plain).toBe('look\n- shot.png')
  })

  it('names an image it cannot inline and reports the shortfall', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: DATA_URL, configurable: true })
      // The mocked reader hands the handler the load event it would fire.
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blobOf(MESSAGE_COPY_IMAGE_LIMIT + 1) })))
    const parts = await buildMessageClipboard({
      text: 'big',
      attachments: [previewImage('blob:huge', 'huge.png')],
    })
    expect(parts.image).toBeUndefined()
    expect(parts.inlined).toBe(0)
    expect(parts.mentioned).toBe(1)
    expect(parts.plain).toBe('big\n- huge.png')
  })

  it('keeps a stored image in the list when the loader rejects', async () => {
    const loadImage = Object.assign(
      () => Promise.reject(new Error('revoked')),
      { peek: () => undefined as string | undefined },
    ) as unknown as MessageImageLoader
    const parts = await buildMessageClipboard({
      text: '',
      attachments: [storedImage('photo', 4096)],
      loadImage,
    })
    expect(parts.inlined).toBe(0)
    expect(parts.plain).toBe('- photo (4 KB)')
  })
})

describe('writeMessageClipboard', () => {
  it('writes text, HTML, and the first image through one ClipboardItem', async () => {
    const clipboard = stubNavigator()
    const parts = await buildMessageClipboard({
      text: 'look',
      attachments: [fileAttachment('report.xlsx', 2048)],
    })
    const result = await writeMessageClipboard({ ...parts, image: DATA_URL })
    expect(result).toStrictEqual({ ok: true, textOnly: false })
    expect(clipboard.write).toHaveBeenCalledTimes(1)
    const [items] = clipboard.write.mock.calls[0] as [FakeClipboardItem[]]
    expect(Object.keys(items[0]!.items).sort()).toStrictEqual(['image/png', 'text/html', 'text/plain'])
  })

  it('falls back to a plain-text write when the multi-flavor API is missing', async () => {
    const clipboard = stubNavigator()
    vi.stubGlobal('ClipboardItem', undefined)
    const parts = await buildMessageClipboard({ text: 'plain only', attachments: [] })
    const result = await writeMessageClipboard(parts)
    expect(result).toStrictEqual({ ok: true, textOnly: true })
    expect(clipboard.write).not.toHaveBeenCalled()
    expect(clipboard.writeText).toHaveBeenCalledWith('plain only')
  })

  it('reports a failed fallback write instead of claiming success', async () => {
    const clipboard = stubNavigator()
    clipboard.writeText.mockRejectedValue(new Error('denied'))
    vi.stubGlobal('ClipboardItem', undefined)
    const parts = await buildMessageClipboard({ text: 'x', attachments: [] })
    expect((await writeMessageClipboard(parts)).ok).toBe(false)
  })
})
