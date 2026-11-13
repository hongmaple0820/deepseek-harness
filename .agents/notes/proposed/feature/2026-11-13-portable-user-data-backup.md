# Agent Note: Portable user-data backup and sync

Status: proposed

English | [中文](2026-11-13-portable-user-data-backup.zh.md)

## Problem

A DSH installation keeps its working state in several places that no single operation can move: `profiles/<name>/package.json` and `cordis.patch.yml` hold installed plugins and their configuration, volatile settings land in that same profile patch, sessions live under `sessions/`, plugins keep non-session records through `ctx.storage`, and credentials sit in `.credentials.yaml` and `.env`. A new machine therefore starts empty: the user reinstalls plugins, retypes settings, and keeps the old sessions inaccessible.

Single-session export already exists in [session-log-export](../../../../packages/session-query/session-log-export/README.md) (`/api/session.export` and `/api/session.markdown`, a ZIP with `session.vN.jsonl`, child sessions, media, files, and a missing-attachment report). Nothing exports or restores settings, plugin configuration, storage records, or a set of sessions, and no path moves any of them between machines.

## Proposal

Add a backup bundle and a restore path for it, then put remote transports behind the same bundle as plugins.

### Bundle contents

One ZIP, `manifest.json` first, then one directory per selected component. The manifest records the bundle schema version, the DSH version that wrote it, the profile name, the session format version when sessions are included, and for every component its file count, byte count, and whether it was redacted.

| Component | Default | Contents |
|---|---|---|
| `profile` | on | `profiles/<name>/package.json` and `cordis.patch.yml` |
| `settings` | on, secrets redacted | The volatile settings section of the profile patch, with every secret replaced by a presence marker |
| `sessions` | off | The existing single-session archive layout, repeated per selected session |
| `credentials` | off | `.credentials.yaml` and `.env` |

Sessions and credentials are off by default because they are the two components that are large and sensitive. Selecting either states what will be written before the export runs.

Redaction replaces a secret value with a presence marker and records the key in the manifest's redaction list. An imported marker restores as unset and the import report names every key the user must fill in again. Credential components are exempt from redaction because the user selected them knowingly; the export still reports the byte count and refuses when the target path is inside the repository.

### Export and import

Export and import run in the Host, next to the session export endpoints, and the settings UI drives them. Import is a two-step operation:

1. **Preview.** Read the bundle, validate its manifest, and report per component: entries added, entries that replace a local value, entries skipped because a local value is newer, and keys import cannot restore without a secret. Nothing is written.
2. **Apply.** Write the accepted components, keeping a timestamped copy of every file it replaces so a wrong import can be undone from the same UI.

Conflict resolution is explicit per component and never a silent merge: keep local, overwrite local, or skip. The preview is the only place that decides, because the bundle is a snapshot rather than a history.

### Sync

Sync is the same bundle stored at a remote target, not a second data model. A target is a plugin implementing a narrow interface — list bundles, upload a bundle, download a bundle by id — and WebDAV and S3 are the first two implementations. A bundle is immutable once uploaded, and each upload adds a new sequence number instead of overwriting, so restoring means picking a snapshot rather than merging two histories. Retention keeps the last N bundles per profile, configurable, and the settings UI lists them with time, size, and the DSH version that wrote them.

Automatic upload is per component and off by default; enabling it for sessions is a separate toggle from enabling it for settings.

## Alternatives considered

- **Archive the whole DSH home.** One tar of everything is the smallest implementation, but it carries credentials without a decision, includes caches and logs, and gives the import no review step. Kept only as an explicit `full` selection that includes credentials.
- **Three-way merge over sessions and settings.** Sync would preserve concurrent edits, but sessions are append-only logs owned by the session package and settings have no total order across machines, so merge semantics would need new ownership in both. Deferred; snapshots plus last-write-wins per snapshot keep the first version honest about what it can promise.
- **Cloud SDKs inside the Host.** Adding WebDAV and S3 clients to the Host makes every future target a core change. Transports stay plugins behind the bundle interface, so a third-party target adds no Host code.

## Acceptance criteria

- An exported bundle imports into an empty `DSH_HOME` and yields the same plugin set, the same settings values, and — when sessions were included — sessions the same version opens.
- A default export contains no secret value; importing a redacted bundle reports every key that needs a value.
- Preview writes nothing and reports added, replaced, and skipped counts per component.
- WebDAV and S3 targets round-trip a bundle, and restore from either yields the same state as restore from a local file.
- On-disk session files are unchanged by export and import; a bundle whose session format version is incompatible is refused with the version pair in the report.

## Risks

- Large session trees make export slow and the bundle large. Mitigation: per-component selection, streaming ZIP creation, and progress reported by the Host.
- Redaction only knows keys it is told about, and a plugin can store a secret under an ordinary setting key. Mitigation: the preview names every settings value that looks like a credential, and the export never logs bundle content.
- Restoring into a newer DSH can meet an older session format. Mitigation: the manifest carries the session format version, and import refuses rather than converting.
- Two machines uploading to the same target race, and last-write-wins loses a snapshot. Mitigation: immutable numbered bundles, per-machine profile names in the manifest, and restore-by-snapshot instead of an implicit merge.
