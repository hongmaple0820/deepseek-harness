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

The Web bundle mounts this companion next to the Host's `user-data-backup` row. Select components with the checkboxes and choose **Download bundle**; the browser saves the file the Host names, a short note under the button says the browser is saving it, and a line under the checkbox grid counts how many of the four components the selection carries. To import, choose **Choose bundle**, pick a ZIP, and read the planned changes: the card says no bundle is chosen until one is, the preview names the file it read or the remote it came from, with the bundle's size beside that name, the plan counts the files it would add, replace and skip, each listed component names the paths it touches, and none of it is on disk yet; opening it moves focus to **Dismiss** and closing it gives focus back to **Choose bundle**. The preview can be dismissed without writing anything. **Apply import** writes the bundle and reports the backup directory that holds the replaced files, naming the remote it restored from when the bundle was fetched.

An import that the Host refuses, or that is unreadable, shows one failure line instead of a plan. An incomplete selection disables export rather than downloading an empty bundle.

**Remote sync** lists every remote, with its kind, where it came from, and the bundles it already holds, each with its size when the Host reports one. **Refresh remotes** reads the list again and the card prints the clock time of that read, so a listing from an earlier moment is not taken for the present; the card names the components a push would upload; **Push bundle** uploads that selection, and its row reports the upload in progress and, once the Host answers, the size it uploaded and how many old bundles it pruned (nothing when it pruned none) — the row's own list shows the bundle that was just stored; when a write lands but the list cannot be read again, the card keeps that receipt and says only the listing is stale; a read that fails is reported above the rows it could not replace, with **Try again** beside it, and the rows an earlier read returned stay on screen under the clock that names that earlier read; **Restore** on a row reports the bundle it is reading, downloads it — counting the bytes as they arrive, so a large bundle says how far it has come — and opens the same preview headed with the remote and bundle it came from, so a bundle from another machine is never written without review; applying that preview reports a restore rather than an import and repeats where it came from. A connection test prints its verdict with the clock time it ran at, so a stale entry count is not mistaken for the present. A deployment with no remotes says so instead of showing an empty list, and that hint carries its own **Add remote** control, so the first remote does not require finding the header button.

**Add remote** opens a form for the protocol and its address fields and hides itself while the form is open, so a typed draft is never thrown away; an address that would not parse, having no scheme, is called out under its field and holds **Save remote** until it does. Only one sync call runs at a time, a refused call reports inside the form that caused it, and both a Host the browser cannot reach and one that gave up on a slow remote are reported apart from a refusal; the remove confirmation takes focus and gives it back to the control it came from. **Save remote** stores the connection through the Host, and the saved row reports each secret as set without ever showing the value. **Test** lists the remote and reports the entry count, or the failure the remote answered with. **Test all** runs the same test on every remote in row order, so one sweep leaves a verdict on every row; the control waits while any single test is running. **Remove** asks for confirmation and says what it does: it forgets the connection saved on this machine, and the bundles on the remote stay; a remote that comes from configuration is labeled **From configuration** and offers no remove button. An import plan lists, below the file changes, the profile fields that stayed masked, so they can be filled in on the new machine.

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
- The page reads remote listings when it opens and when **Refresh remotes** is chosen; a bundle another machine pushes appears after the next refresh.
- There is no progress indicator while a large bundle uploads; the push button stays disabled until the Host answers.
- The plan lists paths per component without per-file sizes, so which component carries the bulk is not broken out; the bundle's own size rides beside its name, so a large bundle is visible before apply.

<a id="dev-note"></a>
### Dev Note

None.
