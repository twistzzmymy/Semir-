# Agent Notes

This repo is an independent Semir cloud drive CLI, not an OpenCLI in-repo adapter.

## Runtime Strategy

- Use the user's already logged-in Chrome CDP session at `http://127.0.0.1:9222`.
- Select the tab whose URL starts with `https://fmp.semirapp.com`.
- If no Semir tab exists, open `https://fmp.semirapp.com/web/index#/home/file` through the same 9222 browser and wait for the user to log in.
- Login readiness is probed through `/fengcloud/1/account/mount` in page context; do not inspect cookie/localStorage/token fields.
- Keep credentials inside the browser page context. Do not read or print cookies, localStorage, sessionStorage, tokens, or auth headers.
- Page requests go through `CdpPage.fetchJson()`, which runs `fetch(..., { credentials: "include" })` inside the Semir cloud drive page.

## Observed Read APIs

- List folder: `GET /fengcloud/1/file/ls`
  - Params: `mount_id`, `fullpath`, `order=filename asc`, `size`, `start`, `current=1`
- Search: `POST /fengcloud/2/file/search`
  - Body: `keyword`, `mount_id`, `scope='["filename", "tag"]'`, `start`, `size`
  - Optional: `fullpath`, `ext`, filesize/member/time filters
- File info: `GET /fengcloud/2/file/info`
  - Params: `mount_id`, `fullpath`
  - Use `ignores=tag,favorite,lock,preview,thumbnail` when a temporary download URL is explicitly requested.
- Preview URL: `GET /fengcloud/2/file/preview_url`
  - Params: `mount_id`, `fullpath`

## Safety

- Default to read-only. Local downloads are allowed only through explicit `download` / `download-images` commands.
- Do not add upload/delete/move/rename/share/link mutation commands without explicit user authorization and fresh tests.
- Do not commit signed preview/download URLs, cookies, tokens, user contact details, or raw response dumps.
- Keep tests offline with fixtures/fakes. Live 9222 smoke checks are useful but should not be required for `npm test`.

## Crawshrimp-Derived Rules

- Keep cloud path parsing in `src/rules.ts`: `挂载点//目录/子目录`.
- Batch image matching should preserve the crawshrimp semantics from `adapters/semir-cloud-drive/batch-image-download.js`:
  - SPU matches `款号-五位色码` image stems.
  - SKC matches exact full SKC image stems.
  - Default duplicate handling is first match per filename stem.
  - Representative SPU mode saves one deterministic color image under the SPU filename.
- Tmall match-buy and new-624 helpers also live in `src/rules.ts`; add dedicated commands on top of those helpers rather than copying logic into `cli.ts`.
- DeepDraw new-arrival packaging rules live in `src/shenhui.ts` and `src/shenhui-plan.ts`; preserve the crawshrimp behavior from `adapters/shenhui-new-arrival/prepare-upload-package.js`.
  - Use search results to locate style folders, then recursively list folder contents.
  - Keep model/still SOP filters separate.
  - Generate plans first; local download is an explicit second step.

## Agent Capability Protocol

- Prefer `semir-yunpan run <capability> -f json` for agent automation.
- Capability input is a JSON object through `--input-json`, `--input-file`, or stdin.
- Capability output is a wrapper: `{ capability, ok, data }` or `{ capability, ok: false, error }`.
- Keep capabilities atomic and composable. Add new scenario commands only when the human workflow clearly benefits from a shorthand.
- Register new capabilities in `src/capabilities.ts` and cover them with offline tests.

## Validation

Run before claiming completion:

```bash
npm test
npm run typecheck
npm run build
```
