/** The WebDAV and S3 transports speak one narrow list/put/get/remove surface. */
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createRemote, pruneRemote } from '../src/remote.ts'

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: unknown
}

function recorder(answer: (call: Call) => Response) {
  const calls: Call[] = []
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = { ...init?.headers as Record<string, string> }
    const call = { url, method: init?.method ?? 'GET', headers, ...init?.body === undefined ? {} : { body: init.body } }
    calls.push(call)
    return answer(call)
  })
  return { calls, request }
}

afterEach(() => { vi.unstubAllGlobals() })

it('lists, writes, reads and deletes WebDAV bundles under the prefix', async () => {
  const { calls, request } = recorder((call) => {
    if (call.method === 'PROPFIND') {
      return new Response('<d:multistatus><d:response><d:href>/dsh/</d:href></d:response><d:response><d:href>/dsh/dsh-web-1.zip</d:href></d:response><d:response><d:href>/dsh/notes.txt</d:href></d:response></d:multistatus>')
    }
    if (call.method === 'GET') return new Response(new Uint8Array([1, 2, 3]))
    return new Response(null, { status: 204 })
  })
  const target = createRemote({ kind: 'webdav', url: 'https://dav.example.com/dsh/', username: 'u', password: 'p' }, request)
  expect(await target.list()).toEqual([{ name: 'dsh-web-1.zip' }])
  expect(calls[0]).toMatchObject({ url: 'https://dav.example.com/dsh/', method: 'PROPFIND' })
  expect(calls[0]!.headers.authorization).toBe('Basic ' + Buffer.from('u:p').toString('base64'))
  expect(calls[0]!.headers.depth).toBe('1')

  await target.put('dsh-web-2.zip', new Uint8Array([9]))
  expect(calls[1]).toMatchObject({ url: 'https://dav.example.com/dsh/dsh-web-2.zip', method: 'PUT' })
  expect(calls[1]!.headers['content-type']).toBe('application/zip')

  expect([...await target.get('dsh-web-2.zip')]).toEqual([1, 2, 3])
  await target.remove('dsh-web-2.zip')
  expect(calls[3]!.method).toBe('DELETE')
})

it('authenticates with a user that has no password', async () => {
  const { calls, request } = recorder(() => new Response(null, { status: 204 }))
  const target = createRemote({ kind: 'webdav', url: 'https://dav.example.com/dsh', username: 'u' }, request)
  await target.put('a.zip', new Uint8Array([1]))
  expect(calls[0]!.headers.authorization).toBe('Basic ' + Buffer.from('u:').toString('base64'))
})

it('reports a WebDAV refusal with the transport and status', async () => {
  const { request } = recorder(() => new Response(null, { status: 507 }))
  const target = createRemote({ kind: 'webdav', url: 'https://dav.example.com/dsh' }, request)
  await expect(target.list()).rejects.toThrow('webdav list failed with 507')
})

it('signs S3 requests and lists bucket contents below the prefix', async () => {
  const body = new TextEncoder().encode('zip')
  const { calls, request } = recorder((call) => {
    if (call.url.includes('list-type=2')) {
      return new Response('<ListBucketResult><Contents><Key>backups/a.zip</Key><Size>12</Size></Contents><Contents><Key>other/b.zip</Key></Contents></ListBucketResult>')
    }
    if (call.method === 'GET') return new Response(new Uint8Array([4, 5]))
    return new Response(null, { status: 200 })
  })
  const target = createRemote({
    kind: 's3',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'bkt',
    accessKeyId: 'aki',
    secretAccessKey: 'secret',
    prefix: 'backups',
  }, request)

  expect(await target.list()).toEqual([{ name: 'a.zip', size: 12 }])
  expect(calls[0]!.url).toBe('https://s3.example.com/bkt/?list-type=2&prefix=backups%2F')
  const authorization = calls[0]!.headers.authorization ?? ''
  const prefix = 'AWS4-HMAC-SHA256 Credential=aki/'
  const signed = ', SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature='
  expect(authorization.startsWith(prefix)).toBe(true)
  expect(authorization).toContain('/us-east-1/s3/aws4_request' + signed)
  expect(authorization.slice(-64)).toMatch(/^[0-9a-f]{64}$/)

  await target.put('c.zip', body)
  expect(calls[1]!.method).toBe('PUT')
  expect(calls[1]!.url).toBe('https://s3.example.com/bkt/backups/c.zip')
  expect(calls[1]!.headers['x-amz-content-sha256']).toBe(createHash('sha256').update(body).digest('hex'))

  expect([...await target.get('c.zip')]).toEqual([4, 5])
  await target.remove('c.zip')
  expect(calls[3]!.method).toBe('DELETE')
})

it('reports an S3 refusal with the transport and status', async () => {
  const { request } = recorder(() => new Response(null, { status: 403 }))
  const target = createRemote({
    kind: 's3', endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'bkt', accessKeyId: 'a', secretAccessKey: 's',
  }, request)
  await expect(target.put('x.zip', new Uint8Array([1]))).rejects.toThrow('s3 put failed with 403')
})

it('prunes every bundle beyond the newest budget', async () => {
  const removed: string[] = []
  const target = {
    list: async () => [{ name: 'a.zip' }, { name: 'b.zip' }, { name: 'c.zip' }],
    put: async () => {},
    get: async () => new Uint8Array(),
    remove: async (name: string) => { removed.push(name) },
  }
  expect(await pruneRemote(target, 2)).toEqual(['a.zip'])
  expect(removed).toEqual(['a.zip'])
  expect(await pruneRemote(target, 0)).toEqual([])
})

it('writes, reads and deletes without credentials and reports each refusal', async () => {
  const answers = new Map<string, Response>()
  answers.set('PUT', new Response(null, { status: 500 }))
  answers.set('GET', new Response(null, { status: 404 }))
  answers.set('DELETE', new Response(null, { status: 423 }))
  const { calls, request } = recorder(call => answers.get(call.method) ?? new Response(null, { status: 204 }))
  const target = createRemote({ kind: 'webdav', url: 'https://dav.example.com/dsh//' }, request)
  await expect(target.put('a.zip', new Uint8Array([1]))).rejects.toThrow('webdav put failed with 500')
  await expect(target.get('a.zip')).rejects.toThrow('webdav get failed with 404')
  await expect(target.remove('a.zip')).rejects.toThrow('webdav delete failed with 423')
  expect(calls[0]!.url).toBe('https://dav.example.com/dsh/a.zip')
  expect(calls[0]!.headers.authorization).toBeUndefined()
})

it('decodes WebDAV hrefs and drops entries that are not bundles', async () => {
  const { request } = recorder(() => new Response(
    '<multistatus><response><href>/dsh/b%20two.zip</href></response><response><href>/dsh/</href></response><response><href>/dsh/a.zip/</href></response><response><href></href></response></multistatus>',
  ))
  const target = createRemote({ kind: 'webdav', url: 'https://dav.example.com/dsh', prefix: '/nested/' }, request)
  expect(await target.list()).toEqual([{ name: 'a.zip' }, { name: 'b two.zip' }])
})

it('reports S3 refusals for listing, reading and deleting', async () => {
  const answers = new Map<string, Response>()
  answers.set('GET', new Response(null, { status: 500 }))
  answers.set('DELETE', new Response(null, { status: 404 }))
  const { request } = recorder(call => answers.get(call.method) ?? new Response(null, { status: 204 }))
  const target = createRemote({
    kind: 's3', endpoint: 'https://s3.example.com', region: 'eu-west-1', bucket: 'bkt', accessKeyId: 'a', secretAccessKey: 's',
  }, request)
  await expect(target.list()).rejects.toThrow('s3 list failed with 500')
  await expect(target.get('a.zip')).rejects.toThrow('s3 get failed with 500')
  await expect(target.remove('a.zip')).rejects.toThrow('s3 delete failed with 404')
})

it('sorts S3 keys and skips entries without a key or bundle name', async () => {
  const { request } = recorder(() => new Response([
    '<ListBucketResult>',
    '<Contents><Size>9</Size></Contents>',
    '<Contents><Key></Key></Contents>',
    '<Contents><Key>notes.txt</Key></Contents>',
    '<Contents><Key>b.zip</Key></Contents>',
    '<Contents><Key>a.zip</Key><Size>3</Size></Contents>',
    '</ListBucketResult>',
  ].join('')))
  const target = createRemote({
    kind: 's3', endpoint: 'https://s3.example.com', region: 'eu-west-1', bucket: 'bkt', accessKeyId: 'a', secretAccessKey: 's',
  }, request)
  expect(await target.list()).toEqual([{ name: 'a.zip', size: 3 }, { name: 'b.zip' }])
})
