import { describe, expect, it } from 'vitest'
import {
  credentialKey,
  type CredentialProvider,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import {
  DEFAULT_KEEP,
  REMOTE_SCOPE,
  deleteRemote,
  readStoredRemotes,
  saveRemote,
  validateRemote,
  viewOf,
  withStoredSecrets,
  type RemoteSettings,
} from '../src/remote-store.ts'

function store(records: Map<string, CredentialRecord>): CredentialProvider {
  return {
    listRecords: async () => [...records].map(([key, record]) => ({ key, kind: record.kind })),
    readRecord: async (key: string) => records.get(key),
    modifyRecord: async (key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const next = await mutate(records.get(key))
      if (next === undefined) records.delete(key)
      else records.set(key, next)
      return next
    },
    deleteRecord: async (key: string) => {
      records.delete(key)
    },
  } as never
}

describe('validateRemote', () => {
  it('accepts a webdav remote with a collection url', () => {
    const settings: RemoteSettings = { kind: 'webdav', url: 'https://dav.example.com/dsh' }
    expect(validateRemote('dav', settings)).toBe(settings)
    expect(() => validateRemote('dav', { kind: 'webdav' })).toThrow('remote dav needs url')
  })

  it('accepts an s3 remote only with every signing field', () => {
    const signing = {
      kind: 's3',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    } satisfies RemoteSettings
    expect(() => validateRemote('cloud', signing)).toThrow('remote cloud needs bucket')
    const settings: RemoteSettings = { ...signing, bucket: 'dsh' }
    expect(validateRemote('cloud', settings)).toBe(settings)
  })

  it('refuses an id and a transport it cannot address', () => {
    expect(() => validateRemote('Dav', { kind: 'webdav', url: 'https://dav.example.com' })).toThrow(/must match/)
    const unknown = JSON.parse('{"kind":"ftp"}') as RemoteSettings
    expect(() => validateRemote('ftp', unknown)).toThrow('remote ftp needs kind webdav or s3')
  })
})

describe('viewOf', () => {
  it('reports set secrets without their values', () => {
    const view = viewOf('dav', {
      kind: 'webdav',
      url: 'https://dav.example.com/dsh',
      username: 'me',
      password: '',
      prefix: 'backups',
    }, 'config')
    expect(view).toEqual({
      id: 'dav',
      kind: 'webdav',
      source: 'config',
      url: 'https://dav.example.com/dsh',
      prefix: 'backups',
      keep: DEFAULT_KEEP,
      secrets: { username: true, password: false, accessKeyId: false, secretAccessKey: false },
    })
  })

  it('leaves an s3 view without fields the remote does not carry', () => {
    const view = viewOf('cloud', { kind: 's3', bucket: 'dsh', keep: 2 }, 'stored')
    expect(view).toEqual({
      id: 'cloud',
      kind: 's3',
      source: 'stored',
      bucket: 'dsh',
      keep: 2,
      secrets: { username: false, password: false, accessKeyId: false, secretAccessKey: false },
    })
  })
})

describe('withStoredSecrets', () => {
  const stored: RemoteSettings = {
    kind: 's3',
    endpoint: 'https://s3.example.com',
    username: 'me',
    password: 'kept',
    accessKeyId: 'id',
    secretAccessKey: 'secret',
  }

  it('returns a draft unchanged when the id held nothing', () => {
    const incoming: RemoteSettings = { kind: 'webdav', url: 'https://dav.example.com' }
    expect(withStoredSecrets(incoming, undefined)).toBe(incoming)
  })

  it('fills blank secrets from the stored record and keeps the new plain fields', () => {
    const merged = withStoredSecrets({
      kind: 's3',
      endpoint: 'https://other.example.com',
      username: 'someone',
      password: '',
      accessKeyId: 'next',
    }, stored)
    expect(merged).toEqual({
      kind: 's3',
      endpoint: 'https://other.example.com',
      username: 'someone',
      password: 'kept',
      accessKeyId: 'next',
      secretAccessKey: 'secret',
    })
  })

  it('keeps a secret the draft spells out again', () => {
    const merged = withStoredSecrets({
      kind: 's3',
      endpoint: 'https://s3.example.com',
      password: 'next',
      secretAccessKey: 'next-secret',
    }, stored)
    expect(merged.password).toBe('next')
    expect(merged.secretAccessKey).toBe('next-secret')
  })
})

describe('readStoredRemotes', () => {
  it('reads nothing without a credential store', async () => {
    expect((await readStoredRemotes(undefined)).size).toBe(0)
  })

  it('keeps only this scope and only grant records naming a transport', async () => {
    const records = new Map<string, CredentialRecord>([
      [credentialKey(REMOTE_SCOPE, 'dav'), { kind: 'grant', payload: { kind: 'webdav', url: 'https://dav.example.com' } }],
      [credentialKey('llm', 'dav'), { kind: 'grant', payload: { kind: 'webdav', url: 'https://other.example.com' } }],
      [credentialKey(REMOTE_SCOPE, 'keyed'), { kind: 'api-key', key: 'secret' }],
      [credentialKey(REMOTE_SCOPE, 'loose'), { kind: 'grant', payload: 'webdav' }],
      [credentialKey(REMOTE_SCOPE, 'empty'), { kind: 'grant', payload: null }],
      [credentialKey(REMOTE_SCOPE, 'ftp'), { kind: 'grant', payload: { kind: 'ftp' } }],
    ])
    const remotes = await readStoredRemotes(store(records))
    expect([...remotes]).toEqual([['dav', { kind: 'webdav', url: 'https://dav.example.com' }]])
  })

  it('round-trips a saved remote and forgets it on delete', async () => {
    const records = new Map<string, CredentialRecord>()
    const credentials = store(records)
    await saveRemote(credentials, 'cloud', { kind: 's3', endpoint: 'https://s3.example.com' })
    expect([...(await readStoredRemotes(credentials)).keys()]).toEqual(['cloud'])
    await deleteRemote(credentials, 'cloud')
    expect((await readStoredRemotes(credentials)).size).toBe(0)
  })
})
