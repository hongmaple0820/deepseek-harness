import { describe, expect, it } from 'vitest'
import { REDACTION_MARKER, redactYaml, restoreRedacted } from '../src/redact.ts'

const composition = [
  'plugins:',
  '  - id: llm',
  '    config:',
  '      apiKey: sk-live',
  '      nested:',
  '        clientSecret: "shh"',
  '      model: deepseek-chat',
  '      baseUrl: ${DSH_BASE}',
  '      endpoint:',
].join('\n')

describe('redacting a composition file', () => {
  it('replaces secret values and leaves every other assignment alone', () => {
    const { text, fields } = redactYaml(composition)
    expect(fields).toBe(2)
    expect(text).toContain('apiKey: "' + REDACTION_MARKER + '"')
    expect(text).toContain('clientSecret: "' + REDACTION_MARKER + '"')
    expect(text).toContain('model: deepseek-chat')
    expect(text).toContain('baseUrl: ${DSH_BASE}')
  })

  it('leaves an already redacted document unchanged', () => {
    const once = redactYaml(composition)
    const twice = redactYaml(once.text)
    expect(twice.fields).toBe(0)
    expect(twice.text).toBe(once.text)
  })

  it('recognizes key names regardless of hyphen and case', () => {
    const { text } = redactYaml('Access-Key: a\nAPI_KEY: b\nrefreshToken: c\n')
    expect(text).toBe('Access-Key: "' + REDACTION_MARKER + '"\nAPI_KEY: "' + REDACTION_MARKER + '"\nrefreshToken: "' + REDACTION_MARKER + '"\n')
  })
})

describe('restoring a redacted composition file', () => {
  it('puts the local value back under the same path', () => {
    const { text } = redactYaml(composition)
    const local = ['plugins:', '  - id: llm', '    config:', '      apiKey: sk-local', '      model: deepseek-chat'].join('\n')
    const merged = restoreRedacted(text, local)
    expect(merged.text).toContain('apiKey: sk-local')
    expect(merged.unresolved).toEqual(['plugins.config.nested.clientSecret'])
  })

  it('reports every marked path when the target has no file yet', () => {
    const { text } = redactYaml(composition)
    const merged = restoreRedacted(text, undefined)
    expect(merged.text).toBe(text)
    expect(merged.unresolved).toEqual(['plugins.config.apiKey', 'plugins.config.nested.clientSecret'])
  })

  it('returns the document untouched when it carries no marker', () => {
    const merged = restoreRedacted('plugins: []\n', undefined)
    expect(merged).toEqual({ text: 'plugins: []\n', unresolved: [] })
  })
})
