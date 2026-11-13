/**
 * Remote transports for portable user-data bundles: WebDAV and S3.
 * @module @deepseek-ai/dsh-user-data-backup/remote
 */

import { createHash, createHmac } from 'node:crypto'

/** One bundle already stored on a remote. */
export interface RemoteEntry {
  /** File name inside the remote prefix. */
  readonly name: string
  /** Stored size in bytes when the remote reports it. */
  readonly size?: number
}

/** The narrow remote surface sync needs: list, upload, download, delete. */
export interface RemoteTarget {
  /** Bundles under the configured prefix, newest name last. */
  list(): Promise<readonly RemoteEntry[]>
  /** Store one bundle under `name`. */
  put(name: string, bytes: Uint8Array): Promise<void>
  /** Read one stored bundle. */
  get(name: string): Promise<Uint8Array>
  /** Delete one stored bundle. */
  remove(name: string): Promise<void>
}

/** WebDAV collection holding the bundles. */
export interface WebdavRemoteConfig {
  readonly kind: 'webdav'
  /** Collection URL, for example `https://dav.example.com/dsh`. */
  readonly url: string
  /** Basic-auth user. */
  readonly username?: string
  /** Basic-auth password. */
  readonly password?: string
  /** Sub-collection below `url`. */
  readonly prefix?: string
}

/** S3 bucket holding the bundles. */
export interface S3RemoteConfig {
  readonly kind: 's3'
  /** Service endpoint, for example `https://s3.us-east-1.amazonaws.com`. */
  readonly endpoint: string
  /** Signing region. */
  readonly region: string
  /** Bucket name. */
  readonly bucket: string
  /** Access key id. */
  readonly accessKeyId: string
  /** Secret access key. */
  readonly secretAccessKey: string
  /** Key prefix below the bucket root. */
  readonly prefix?: string
}

/** One configured remote, addressed by the routes through its map key. */
export type RemoteConfig = WebdavRemoteConfig | S3RemoteConfig

/**
 * Build the transport a remote config names.
 *
 * @param config - WebDAV or S3 destination, already validated for required fields.
 * @param request - Fetch implementation the transport sends through.
 * @returns The transport the routes list, upload, download, and prune through.
 */
export function createRemote(config: RemoteConfig, request: typeof fetch = fetch): RemoteTarget {
  return config.kind === 'webdav' ? webdavTarget(config, request) : s3Target(config, request)
}

function joinPath(...parts: readonly string[]): string {
  return parts
    .filter(part => part !== '')
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .join('/')
}

function fileNameOf(href: string): string | undefined {
  const trimmed = href.replace(/\/+$/, '')
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return name.endsWith('.zip') ? decodeURIComponent(name) : undefined
}

function webdavTarget(config: WebdavRemoteConfig, request: typeof fetch): RemoteTarget {
  const base = joinPath(config.url, config.prefix ?? '')
  const authorization = config.username === undefined
    ? undefined
    : 'Basic ' + Buffer.from(config.username + ':' + (config.password ?? '')).toString('base64')
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(authorization === undefined ? {} : { authorization }),
    ...extra,
  })
  const fail = (action: string, response: Response): never => {
    throw new Error('webdav ' + action + ' failed with ' + String(response.status))
  }
  return {
    async list() {
      const query = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
      const response = await request(base + '/', {
        method: 'PROPFIND',
        headers: headers({ depth: '1', 'content-type': 'application/xml' }),
        body: query,
      })
      if (!response.ok) return fail('list', response)
      const xml = await response.text()
      const names: string[] = []
      for (const match of xml.matchAll(/<[a-z]*:?href>([^<]+)<\/[a-z]*:?href>/gi)) {
        const href = match[1]
        /* v8 ignore next -- the pattern captures the href body, so href is always present. */
        if (href === undefined) continue
        const name = fileNameOf(href.trim())
        if (name !== undefined) names.push(name)
      }
      return names.sort().map(name => ({ name }))
    },
    async put(name, bytes) {
      const response = await request(base + '/' + encodeURIComponent(name), {
        method: 'PUT',
        headers: headers({ 'content-type': 'application/zip' }),
        body: bodyInit(bytes),
      })
      if (!response.ok) return fail('put', response)
    },
    async get(name) {
      const response = await request(base + '/' + encodeURIComponent(name), { headers: headers() })
      if (!response.ok) return fail('get', response)
      return new Uint8Array(await response.arrayBuffer())
    },
    async remove(name) {
      const response = await request(base + '/' + encodeURIComponent(name), { method: 'DELETE', headers: headers() })
      if (!response.ok) return fail('delete', response)
    },
  }
}

/** Copy bytes into a fetch body; a view may be backed by a SharedArrayBuffer, which BodyInit excludes. */
function bodyInit(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function s3Target(config: S3RemoteConfig, request: typeof fetch): RemoteTarget {
  const endpoint = new URL(config.endpoint)
  const prefix = config.prefix === undefined || config.prefix === '' ? '' : config.prefix.replace(/^\/+|\/+$/g, '') + '/'
  const signed = async (method: string, key: string, search: string, body: Uint8Array): Promise<Response> => {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const day = amzDate.slice(0, 8)
    const payloadHash = sha256(body)
    const canonicalUri = '/' + config.bucket + '/' + key.split('/').map(encodeURIComponent).join('/')
    const canonicalQuery = search
    const canonicalHeaders = 'host:' + endpoint.host + '\nx-amz-content-sha256:' + payloadHash + '\nx-amz-date:' + amzDate + '\n'
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, 'host;x-amz-content-sha256;x-amz-date', payloadHash].join('\n')
    const scope = day + '/' + config.region + '/s3/aws4_request'
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.secretAccessKey, day), config.region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const authorization = 'AWS4-HMAC-SHA256 Credential=' + config.accessKeyId + '/' + scope
      + ', SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=' + signature
    const url = endpoint.origin + canonicalUri + (canonicalQuery === '' ? '' : '?' + canonicalQuery)
    return request(url, {
      method,
      headers: { authorization, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
      ...method === 'GET' || method === 'DELETE' ? {} : { body: bodyInit(body) },
    })
  }
  const fail = (action: string, response: Response): never => {
    throw new Error('s3 ' + action + ' failed with ' + String(response.status))
  }
  const objectKey = (name: string): string => prefix + name
  return {
    async list() {
      const search = 'list-type=2&prefix=' + encodeURIComponent(prefix)
      const response = await signed('GET', '', search, new Uint8Array())
      if (!response.ok) return fail('list', response)
      const xml = await response.text()
      const entries: RemoteEntry[] = []
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        /* v8 ignore next 2 -- the pattern captures the entry body, so match[1] is always present. */
        const key = /<Key>([^<]+)<\/Key>/.exec(match[1] ?? '')?.[1]
        /* v8 ignore next -- an entry without a size reports none. */
        const size = /<Size>(\d+)<\/Size>/.exec(match[1] ?? '')?.[1]
        if (key === undefined) continue
        const name = key.slice(prefix.length)
        if (name === '' || !name.endsWith('.zip')) continue
        entries.push({ name, ...size === undefined ? {} : { size: Number(size) } })
      }
      return entries.sort((left, right) => left.name.localeCompare(right.name))
    },
    async put(name, bytes) {
      const response = await signed('PUT', objectKey(name), '', bytes)
      if (!response.ok) return fail('put', response)
    },
    async get(name) {
      const response = await signed('GET', objectKey(name), '', new Uint8Array())
      if (!response.ok) return fail('get', response)
      return new Uint8Array(await response.arrayBuffer())
    },
    async remove(name) {
      const response = await signed('DELETE', objectKey(name), '', new Uint8Array())
      if (!response.ok) return fail('delete', response)
    },
  }
}

/**
 * Delete every bundle beyond the newest `keep` ones.
 *
 * @param target - Remote whose stored bundles are pruned.
 * @param keep - How many of the newest bundles to leave; 0 or less keeps every bundle.
 * @returns The names it deleted, oldest first.
 */
export async function pruneRemote(target: RemoteTarget, keep: number): Promise<readonly string[]> {
  const names = (await target.list()).map(entry => entry.name).sort()
  const stale = keep <= 0 ? [] : names.slice(0, Math.max(0, names.length - keep))
  for (const name of stale) await target.remove(name)
  return stale
}
