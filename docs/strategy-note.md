# Strategy Note

## Goal

Build a CLI for Semir cloud drive focused on style-number search, image package discovery, and path-based file lookup for both humans and AI agents.

## Selected Strategy

Strategy: `PAGE_FETCH`

Contract: `internal-unstable`

Evidence:

- Logged-in page: `https://fmp.semirapp.com/web/index#/home/file/mount/2023`
- Framework: Vue 2 application
- Folder list endpoint observed from performance entries:
  - `GET /fengcloud/1/file/ls?order=filename+asc&size=100&start=0&fullpath=&mount_id=2023&current=1`
- Search endpoint found in the frontend bundle and verified in page context:
  - `POST /fengcloud/2/file/search`
  - Payload includes `keyword`, `mount_id`, `scope`, `start`, `size`
- File info and URL endpoints verified in page context:
  - `GET /fengcloud/2/file/info`
  - `GET /fengcloud/2/file/preview_url`

Why not `COOKIE_API`:

- The safer implementation keeps auth material inside the logged-in browser tab instead of exporting cookies into Node.

Why not UI selectors:

- Search/list/info are JSON-backed and more stable than table DOM selectors.
- UI remains useful for readback, but the CLI does not need to click or type for read-only workflows.

## Current Scope

Implemented:

- login/open/wait flow against the user's existing 9222 browser
- `mounts`
- `ls`
- `search`
- `style`
- `info`
- `preview-url`
- `download-url`
- `download`
- `download-images`
- `inspect-images`
- `download-catalog`
- `download-by-rules`
- `run <capability>` unified JSON protocol for AI agents

Crawshrimp logic imported into reusable TS helpers:

- `挂载点//目录/子目录` cloud path parsing
- SPU/SKC code classification and matching
- first-per-stem duplicate handling
- representative SPU image naming
- Tmall match-buy `3` / `3-n` image-name recognition
- new-624 `3-1` full-body and same-SKC still-life recognition
- DeepDraw new-arrival folder locating, recursive listing, model/still SOP filtering, yq naming, and package planning
- generic folder inspection by path/code/folder-rule, optional signed URL enrichment, plus user-defined image-pick rules
- generic catalog batch-download planning from inspected image rows

Not implemented yet:

- zip packaging
- dedicated Tmall match-buy command from Excel input
- dedicated new-624 command from multiline SKC input, if a shorthand still becomes useful
- dedicated DeepDraw upload command in this standalone CLI
- upload/delete/move/rename/share/link management

Server-side mutation commands remain intentionally excluded. Download commands only write local files after explicit user invocation.

## Capability Direction

The core architecture is now:

1. Browser/session atomics: open/reuse 9222, wait for login, probe session.
2. Semir API atomics: resolve mount, list, search, info, preview URL, download URL.
3. Rule atomics: parse path, normalize codes, filter images, classify DeepDraw assets, match user-defined folder/image rules.
4. Planning atomics: image catalogs, catalog download plans, rule-based image download plans, and DeepDraw new-arrival package plans.
5. Side-effect atomics: explicit local downloads only.

Human scenario commands such as `download-images` should remain thin wrappers over the capability layer.
