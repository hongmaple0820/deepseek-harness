/**
 * Clipboard payloads for one transcript message.
 *
 * The message copy control used to write the plain text alone, so an image or a
 * file the user attached never left the page: `blob:` URLs expire and no other
 * host resolves them. This builder turns the same content into three clipboard
 * flavors — plain text with an attachment list, HTML with inlined images, and
 * the first image as PNG — so paste targets that understand rich content keep
 * the pictures instead of the reader retyping the message.
 */

import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UserContentAttachment } from '../contract/slots.ts'

/** Largest image inlined into HTML or offered as PNG; larger ones only reach the text list. */
export const MESSAGE_COPY_IMAGE_LIMIT = 8 * 1024 * 1024

/** Clipboard flavors for one message copy. */
export interface MessageClipboardParts {
  /** Text flavor: the message text, then one line per attachment. */
  readonly plain: string
  /** HTML flavor: the text as paragraphs with inlined images. */
  readonly html: string
  /** First inlined image as a PNG data URL, when the host can carry one. */
  readonly image: string | undefined
  /** Attachments the copy mentions in text. */
  readonly mentioned: number
  /** Images the copy inlined; below the attachment count when a load failed or a size limit applied. */
  readonly inlined: number
}

/** Input for one message copy: the text, its attachments, and how to resolve image bytes. */
export interface MessageCopyInput {
  readonly text: string
  readonly attachments: readonly UserContentAttachment[]
  /** Resolves an image attachment to a fetchable URL; omitted images stay in the text list only. */
  readonly loadImage?: MessageImageLoader | undefined
}

/**
 * Render a byte count the way attachment cards do.
 * @param bytes - exact byte length.
 * @returns A compact size such as `820 B`, `12 KB`, or `1.4 MB`.
 */
export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Attachment display name: the stored filename, or the image's label/preview name. */
function attachmentName(attachment: UserContentAttachment): string {
  if (attachment.type === 'file') return attachment.file.name
  const source = attachment.image
  if ('preview' in source) return source.preview.name ?? 'image'
  return source.label
    ?? `${source.attachment.mediaType} ${String(source.attachment.width)}×${String(source.attachment.height)}`
}

/** Attachment size in the text list, when the reference carries one. */
function attachmentBytes(attachment: UserContentAttachment): number | undefined {
  if (attachment.type === 'file') return attachment.file.bytes
  return 'attachment' in attachment.image ? attachment.image.attachment.bytes : undefined
}

/** One `name — size` line per attachment, in content order. */
function attachmentLines(attachments: readonly UserContentAttachment[]): string[] {
  return attachments.map((attachment) => {
    const bytes = attachmentBytes(attachment)
    const name = attachmentName(attachment)
    return bytes === undefined ? `- ${name}` : `- ${name} (${formatAttachmentBytes(bytes)})`
  })
}

/** Escape text for the HTML flavor. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Fetchable URL of one image attachment, or undefined when the copy cannot reach the bytes. */
async function imageUrl(attachment: UserContentAttachment, loadImage: MessageImageLoader | undefined): Promise<string | undefined> {
  if (attachment.type !== 'image') return undefined
  const source = attachment.image
  if ('preview' in source) return source.preview.url
  if (loadImage === undefined) return undefined
  try {
    const url = loadImage.peek?.(source.attachment) ?? await loadImage(source.attachment)
    return url === '' ? undefined : url
  } catch {
    // A rejected loader means the bytes are gone (revoked URL, dropped cache); the text list still names the image.
    return undefined
  }
}

/**
 * Read one image URL as a data URL.
 * @param url - any fetchable URL, including `blob:` and `data:`.
 * @returns The data URL, or undefined when the read fails or exceeds the inline limit.
 */
async function toDataUrl(url: string): Promise<string | undefined> {
  if (url.startsWith('data:')) return url
  try {
    const response = await fetch(url)
    if (!response.ok) return undefined
    const blob = await response.blob()
    if (blob.size > MESSAGE_COPY_IMAGE_LIMIT) return undefined
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : undefined) }
      reader.onerror = () => { resolve(undefined) }
      reader.readAsDataURL(blob)
    })
  } catch {
    // A cross-origin or expired URL cannot be read; the plain text list remains the fallback.
    return undefined
  }
}

/**
 * Build the clipboard flavors for one message.
 * @param input - text, attachments, and the optional image loader.
 * @returns Every flavor to write, plus how many attachments were mentioned and inlined.
 */
export async function buildMessageClipboard(input: MessageCopyInput): Promise<MessageClipboardParts> {
  const { text, attachments, loadImage } = input
  const lines = attachmentLines(attachments)
  const plain = text.trim() === '' ? lines.join('\n') : [text, ...lines].join('\n')
  const inline: { readonly url: string; readonly name: string }[] = []
  let image: string | undefined
  for (const attachment of attachments) {
    const url = await imageUrl(attachment, loadImage)
    if (url === undefined) continue
    const dataUrl = await toDataUrl(url)
    if (dataUrl === undefined) continue
    inline.push({ url: dataUrl, name: attachmentName(attachment) })
    image ??= dataUrl
  }
  const htmlBody = text.trim() === '' ? '' : `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
  const htmlAttachments = inline.map(({ url, name }) => `<p><img src="${url}" alt="${escapeHtml(name)}"></p>`).join('')
  const htmlList = lines.length === 0 ? '' : `<p>${lines.map(line => escapeHtml(line)).join('<br>')}</p>`
  return {
    plain,
    html: `<div>${htmlBody}${htmlAttachments}${htmlList}</div>`,
    image,
    mentioned: lines.length,
    inlined: inline.length,
  }
}

/**
 * Write the built flavors to the clipboard, preferring the multi-flavor API and
 * falling back to plain text where the host refuses it.
 * @param parts - flavors from {@link buildMessageClipboard}.
 * @returns true when a write was accepted; `imageDropped` reports a text-only fallback.
 */
export async function writeMessageClipboard(parts: MessageClipboardParts): Promise<{ ok: boolean; textOnly: boolean }> {
  const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  // Read through the clipboard object on the host that has one; the API is
  // optional, and covering the rich path at all depends on this probe.
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (ClipboardItemCtor !== undefined && typeof clipboard?.write === 'function' && typeof Blob === 'function') {
    try {
      const items: Record<string, Blob> = {
        'text/plain': new Blob([parts.plain], { type: 'text/plain' }),
        'text/html': new Blob([parts.html], { type: 'text/html' }),
      }
      if (parts.image !== undefined) {
        const png = await fetch(parts.image).then(async response => await response.blob())
        items['image/png'] = png
      }
      await clipboard.write([new ClipboardItemCtor(items)])
      return { ok: true, textOnly: false }
    } catch {
      // Permission or format rejection: fall through to the plain-text write below.
    }
  }
  const ok = await writeClipboard(parts.plain)
  return { ok, textOnly: true }
}
