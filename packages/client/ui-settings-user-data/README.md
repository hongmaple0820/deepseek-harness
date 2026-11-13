---
description: "User data settings page: export a portable bundle and preview an import before applying it."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-user-data

English | [中文](README.zh.md)

## Summary

**Settings → User data** carries one profile between machines. The page exports a ZIP bundle from a component selection and imports a bundle in two steps: choosing a file shows what would be added and replaced, and only the apply button writes. Profile files and the redacted settings snapshot are pre-selected; Session logs and credentials start off. Remotes appear below the file actions: the page lists the ones the deployment configured, adds and removes its own, tests them, and pushes or restores the same bundle.

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

The Web bundle mounts this companion next to the Host's `user-data-backup` row. Select components with the checkboxes and choose **Download bundle**; the browser saves the file the Host names. To import, choose **Choose bundle**, pick a ZIP, and read the planned changes: each listed component names the paths it would add and replace, and none of it is on disk yet. **Apply import** writes the bundle and reports the backup directory that holds the replaced files.

An import that the Host refuses, or that is unreadable, shows one failure line instead of a plan. An incomplete selection disables export rather than downloading an empty bundle.

**Remote sync** lists every remote, with its kind, where it came from, and the bundles it already holds. **Refresh remotes** reads the list again; **Push bundle** uploads the current selection and reports the stored name together with how many old bundles the Host pruned; **Restore** on a row downloads that bundle and opens the same preview, so a bundle from another machine is never written without review. A deployment with no remotes says so instead of showing an empty list.

**Add remote** opens a form for the protocol and its address fields; **Save remote** stores it through the Host, and the saved row reports each secret as set without ever showing the value. **Test** lists the remote and reports the entry count, or the failure the remote answered with. **Remove** deletes a remote this machine added; a remote that comes from configuration is labeled **From configuration** and offers no remove button. An import plan lists, below the file changes, the profile fields that stayed masked, so they can be filled in on the new machine.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

`transfer.ts` owns the route addresses, the JSON calls, and the stored-bundle download, and is the only module that knows the wire. `UserDataSection.tsx` is a pure component over its props: selection, remote listings, pending plan, applied result, and failure live in local state, the download action arrives injected, and a save drops the fields left blank so the Host keeps the secrets it already stored. `index.ts` registers the `settings.section` page with its locale namespace and injects the anchor-click download.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [User-data backup Host package](../../storage/user-data-backup/README.md) — bundle layout, the routes, and import rules.
- [Settings](../ui-settings/README.md) — how a settings section is declared and registered.
- [Web client](../../../docs/subsystems/web-client.md) — plugin composition and the settings surface.

<a id="model-experience"></a>
## Model Experience

None, as this page contributes no model-visible content.

#### KV Cache effect

None; the page only moves files between browsers and this machine.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A stored remote's secrets are write-only from here: an existing password or key reads as set, and changing it means typing a new value.
- A remote id that the configuration already declares is refused when added from the page.
- The page reads remote listings when it mounts and on request; a bundle another machine pushes afterwards appears only after **Refresh remotes**.
- There is no progress indicator while a large bundle uploads; the push button stays disabled until the Host answers.
- The plan lists paths per component without per-file sizes, so a large Sessions bundle gives no size warning before apply.

<a id="dev-note"></a>
### Dev Note

None.
