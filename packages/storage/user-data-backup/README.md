---
description: "Portable user-data bundle: one ZIP over profile files and redacted settings, with a previewed import."
kind: "package-reference"
---

# @deepseek-ai/dsh-user-data-backup

English | [中文](README.zh.md)

## Summary

`dsh-user-data-backup` carries one profile between machines as a single ZIP bundle. It serves three authenticated Host routes: export a bundle from a component selection, preview what importing a bundle would change, and apply that import. Profile files (`package.json`, `cordis.patch.yml`, and `pnpm-lock.yaml`) and the redacted settings snapshot are the default selection; Session logs and credentials are additive. Import never writes blind: the preview reports added and replaced files, and applying first copies every replaced file into `<DSH_HOME>/backups/<timestamp>/`. Remotes come from the plugin config or from the settings page, which keeps what it adds in the credential store, and an optional interval pushes a fresh bundle to each of them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin where Connection is served. It requires `connection`, reads the active profile from `profileContext`, and reads its settings snapshot from the `settings` service. The settings page in [`ui-settings-user-data`](../../client/ui-settings-user-data/README.md) drives all three routes.

| Route | Method | Answer |
| --- | --- | --- |
| `/api/user-data.export?components=profile,settings` | GET, HEAD | ZIP with `Content-Disposition: attachment` |
| `/api/user-data.import.preview` | POST (buffered body) | `RestorePlan` JSON |
| `/api/user-data.import` | POST (buffered body) | `RestorePlan` JSON after writing |
| `/api/user-data.remotes` | GET, HEAD | Every remote as a `RemoteView` |
| `/api/user-data.remotes.save` | POST (buffered body) | The saved `RemoteView` |
| `/api/user-data.remotes.delete` | POST (buffered body) | `{deleted: id}` |
| `/api/user-data.remotes.test` | POST (buffered body) | `{ok, entries}` or `{ok, error}` |
| `/api/user-data.sync.list?id=` | GET, HEAD | `{entries}` in the remote |
| `/api/user-data.sync.push?id=&components=` | POST | `{name, pruned}` after upload |
| `/api/user-data.sync.bundle?id=&name=` | GET, HEAD | The stored ZIP |

A `RestorePlan` lists, per component, the relative paths it would add, replace, or skip, plus the backup directory the apply step wrote to. The preview performs no writes.

### Bundle layout

`manifest.json` comes first and records the bundle schema version, the writing build's version, the profile name, the Session format version when Sessions are included, and per-component file counts, bytes, and redaction. Component files follow under `profile/`, `settings/`, `sessions/`, and `credentials/`.

- **profile** — `package.json` and `pnpm-lock.yaml` as they are, plus `cordis.patch.yml` with every secret-named YAML value replaced by a marker.
- **settings** — one snapshot of every user layer, written to `settings/sections.json`; secrets are recorded as set-or-unset markers, never values.
- **sessions** — Session logs under `<DSH_HOME>/sessions/`.
- **credentials** — `.credentials.yaml` as it is; off by default because it carries live secrets.

### Import rules

A bundle whose Sessions were written by a different Session format version is refused with both versions named. A path that leaves its component directory is refused. Applying replaces the settings sections it carries through the `settings` service, so a live client sees the new values without a reload. A marked profile value is restored from the local file when that file still holds it; otherwise it stays masked and the plan names the field under `placeholders`, so the importer knows what to fill in afterwards.

### Remote sync

Each entry under `remotes` in the plugin config names one WebDAV or S3 destination and how many bundles to keep:

```yaml
remotes:
  dav:
    kind: webdav
    url: https://dav.example.com/dsh
    username: me
    password: secret
    prefix: backups
    keep: 10
  s3:
    kind: s3
    endpoint: https://s3.example.com
    region: us-east-1
    bucket: dsh
    accessKeyId: key
    secretAccessKey: secret
```

A missing field fails at load, naming the remote and the field. Pushing exports a bundle, uploads it under its timestamped file name, then deletes the oldest bundles beyond `keep` (default 10; `0` keeps everything). A stored bundle is never overwritten: the name carries creation time to the millisecond. Listing and downloading only read; restoring a remote bundle reuses the previewed import path, so a bundle from another machine is inspected before it lands.

Remotes added from the settings page live in the credential store under the `user-data-backup` scope, keyed by remote id, and `/api/user-data.remotes` reports where each one came from. Saving an existing id keeps the stored secret fields it leaves blank. `/api/user-data.remotes.test` lists a remote without writing anything, which is what the page's **Test** button reports.

An interval push repeats the same upload for every remote:

```yaml
schedule:
  everyMinutes: 60
  components: [profile, settings]
```

`everyMinutes` of `0` or less stays off, and `components` defaults to the profile and settings pair. The timer runs only while the Host runs, and each round exports one bundle and sends the same bytes everywhere.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

`bundle.ts` owns collection, the manifest contract, ZIP creation with `fflate`, and manifest-first reading. `restore.ts` is pure path planning: it maps bundle prefixes onto the profile directory, `<DSH_HOME>/sessions`, and `<DSH_HOME>`, rejects escapes and unknown prefixes, and separates the settings snapshot from file decisions. `remote.ts` is the transport: a WebDAV client over `PROPFIND`/`PUT`/`GET`/`DELETE` and an S3 client signing SigV4 `ListObjectsV2`/`PutObject`/`GetObject`/`DeleteObject` with `node:crypto`, both behind one `list`/`put`/`get`/`remove` interface plus `pruneRemote`. `redact.ts` walks YAML assignments with their indentation path, masks secret-named values, and puts them back from the local file on import. `remote-store.ts` validates a remote, projects it as a `RemoteView` with set-or-unset secret flags, and reads and writes stored remotes through the `credentials` service. `index.ts` is the Cordis service: it builds the bundle, registers the routes on Connection, applies a plan by copying replaced files into the backup directory before writing, merges config and stored remotes into one table, and runs the interval push.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Portable user-data backup proposal](../../../.agents/notes/proposed/feature/2026-11-13-portable-user-data-backup.md) — component defaults, the two-step import, and the remote-sync design behind these routes.
- [User data settings page](../../client/ui-settings-user-data/README.md) — the browser surface over these routes.
- [Settings](../../settings/settings/README.md) — accepted values, redaction, and live application.
- [Home paths](../../util/home-paths/README.md) — `DSH_HOME` layout and the profile directory.

<a id="model-experience"></a>
## Model Experience

None, as no route contributes model-visible content.

#### KV Cache effect

None; bundles are written and read outside model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Profile redaction covers YAML assignments whose key ends in a secret-like word; a secret stored under any other key travels verbatim.
- The interval push runs while the Host runs; nothing watches files for changes, and two machines still leave two series.
- Sync talks to WebDAV and S3 only; another backend needs its own `list`/`put`/`get`/`remove` implementation.
- Two machines pushing the same profile leave both series in the remote; nothing reconciles or compares them.
- The export route reads a whole profile synchronously; a very large `sessions/` selection holds the request until the ZIP is complete.
- Credentials are included verbatim when selected, so a bundle with them is a secret.

<a id="dev-note"></a>
### Dev Note

Bundle files are read and written with `node:fs/promises`; nothing here touches Session persistence APIs.
