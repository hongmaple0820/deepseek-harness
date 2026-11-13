/**
 * Secret redaction for YAML composition files carried by a bundle: values a
 * deployment treats as credentials leave as a marker, and a restore puts the
 * local value back.
 * @module @deepseek-ai/dsh-user-data-backup/redact
 */

/** Stands in for a secret value inside a bundle. */
export const REDACTION_MARKER = '__DSH_REDACTED__'

const SECRET_KEY = /(?:token|password|passwd|secret|api[-_]?key|authorization|access[-_]?key|credential)s?$/i
const ASSIGNMENT = /^(\s*)([A-Za-z0-9_.-]+):(\s*)(\S.*)?$/
const INTERPOLATED = /^\$|^\$\{|^!!js/

interface Assignment {
  readonly depth: string
  readonly key: string
  readonly path: string
  readonly gap: string
  readonly value: string
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key.replaceAll('-', '_'))
}

/**
 * Walk a document once, naming every assignment by the path its indentation implies.
 * @param text YAML document to walk.
 * @param visit Called for each assignment line with its path and value parts.
 * @returns The document with the visited lines replaced by what visit returned.
 */
function mapAssignments(text: string, visit: (line: Assignment) => string): string {
  const stack: { depth: number; key: string }[] = []
  return text.split('\n').map((raw) => {
    const match = ASSIGNMENT.exec(raw)
    if (match === null) return raw
    /* v8 ignore start -- the pattern always captures its four groups; the fallbacks only satisfy noUncheckedIndexedAccess. */
    const indent = match[1] ?? ''
    const key = match[2] ?? ''
    const gap = match[3] ?? ''
    const value = match[4] ?? ''
    /* v8 ignore stop */
    const depth = indent.length
    while ((stack.at(-1)?.depth ?? -1) >= depth) stack.pop()
    const path = [...stack.map(entry => entry.key), key].join('.')
    stack.push({ depth, key })
    return visit({ depth: indent, key, path, gap, value })
  }).join('\n')
}

/**
 * Replace every secret-looking assignment with a marker.
 * @param text YAML document to redact.
 * @returns The redacted document and how many values it replaced.
 */
export function redactYaml(text: string): { text: string; fields: number } {
  let fields = 0
  const redacted = mapAssignments(text, (line) => {
    const plain = line.value.replace(/^["']|["']$/g, '')
    if (!isSecretKey(line.key) || plain.includes(REDACTION_MARKER) || plain === '' || INTERPOLATED.test(plain)) return line.depth + line.key + ':' + line.gap + line.value
    fields += 1
    return line.depth + line.key + ':' + line.gap + '"' + REDACTION_MARKER + '"'
  })
  return { text: redacted, fields }
}

/**
 * Put the local value back into every marked assignment.
 * @param bundle Text a bundle carries, with markers where secrets stood.
 * @param local Current file contents, when the target already has the file.
 * @returns The text to write and the paths no local value could fill.
 */
export function restoreRedacted(bundle: string, local: string | undefined): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  if (!bundle.includes(REDACTION_MARKER)) return { text: bundle, unresolved }
  const known = new Map<string, string>()
  if (local !== undefined) {
    mapAssignments(local, (line) => {
      known.set(line.path, line.key + ':' + line.gap + line.value)
      return ''
    })
  }
  const text = mapAssignments(bundle, (line) => {
    if (!line.value.includes(REDACTION_MARKER)) return line.depth + line.key + ':' + line.gap + line.value
    const hit = known.get(line.path)
    if (hit === undefined) {
      unresolved.push(line.path)
      return line.depth + line.key + ':' + line.gap + line.value
    }
    return line.depth + hit
  })
  return { text, unresolved }
}
