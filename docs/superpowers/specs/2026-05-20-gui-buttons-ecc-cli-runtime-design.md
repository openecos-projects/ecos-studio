# GUI Buttons ECC CLI Runtime Design

## Goal

Replace the desktop GUI button execution backend from the FastAPI workspace API to the ECC workspace CLI while keeping the renderer-facing button API stable.

## Current Shape

The renderer already sends workspace and flow button actions through `window.ecosDesktop.cli.execute(...)` when running in Electron. Electron main receives those requests through `DesktopRuntimeManager`, but the active adapter is still `ApiCliAdapter`, which forwards requests to `/api/workspace/*`.

Current path:

```text
Vue button
  -> renderer API wrapper
  -> preload desktop CLI bridge
  -> Electron main DesktopRuntimeManager
  -> ApiCliAdapter
  -> FastAPI /api/workspace/*
  -> chipcompiler
```

Target path:

```text
Vue button
  -> renderer API wrapper
  -> preload desktop CLI bridge
  -> Electron main DesktopRuntimeManager
  -> EccCliAdapter
  -> child_process.spawn("ecc", ["workspace", ...])
  -> chipcompiler
```

The terminal stays on the shell service path. Terminal input should not be routed through the button command adapter.

## Command Mapping

`EccCliAdapter` maps existing GUI command names to `ecc workspace` commands:

| GUI command | CLI command |
| --- | --- |
| `create_workspace` | `ecc workspace create --input-json <temp-request.json> --json` |
| `load_workspace` | `ecc workspace load --directory <directory> --json` |
| `run_step` | `ecc workspace run-step --directory <activeWorkspace> --step <step> --json [--rerun]` |
| `rtl2gds` | `ecc workspace run-flow --directory <activeWorkspace> --json [--rerun]` |
| `get_info` | `ecc workspace get-info --directory <activeWorkspace> --step <step> --id <id> --json` |
| `home_page` | `ecc workspace get-home --directory <activeWorkspace> --json` |
| `set_pdk_root` | compatibility response handled in Electron unless a dedicated PDK settings CLI task adds a command |

`create_workspace` should use `--input-json` instead of many field flags because the renderer already sends the server-compatible request shape:

```json
{
  "directory": "/path/to/workspace",
  "pdk": "ics55",
  "pdk_root": "/path/to/icsprout55-pdk",
  "parameters": {},
  "origin_def": "",
  "origin_verilog": "/path/to/top.v",
  "filelist": "",
  "rtl_list": ["/path/to/top.v"]
}
```

Writing this object to a temporary JSON file avoids shell quoting issues and matches `ecc workspace create --input-json`.

## Active Workspace

`ecc workspace` commands intentionally do not remember a current workspace, but existing GUI calls such as `run_step`, `rtl2gds`, `get_info`, and `home_page` often do not include `directory`.

Electron main should therefore keep desktop runtime session state:

- On successful `create_workspace`, set `activeWorkspace` to `result.data.directory`.
- On successful `load_workspace`, set `activeWorkspace` to `result.data.directory`.
- For `run_step`, `rtl2gds`, `get_info`, and `home_page`, use `request.data.directory` if present, otherwise use `activeWorkspace`.
- If no directory is available, return a structured failed result: `missing required field: directory`.

This state belongs in Electron main, not in renderer components.

## Runtime Adapter Behavior

`EccCliAdapter` should:

- Spawn `ecc` directly with argv arrays, not shell strings.
- Use the runtime env produced by `createDevEccCliRuntimeEnv(...)` so development builds can find the local ECC CLI through the generated wrapper.
- Parse the final JSON response from CLI stdout.
- Forward non-JSON stdout and stderr as `stdout` or `stderr` runtime events.
- Normalize CLI response objects into `DesktopCliCommandResult`.
- Treat CLI exit code `0` as success only when the parsed response is `success` or `warning`.
- Treat a non-zero exit without a parsed result as an `error` result with stderr/stdout context.
- Treat malformed JSON as an `error` result while still forwarding raw output events for debugging.

During rollout, keep a backend switch:

```text
ECOS_RUNTIME_BACKEND=api
ECOS_RUNTIME_BACKEND=cli
```

Default should remain `api` until CLI button parity is verified. After parity, switch default to `cli` and keep the API fallback for one release cycle.

## Renderer Scope

Renderer API wrappers should keep their current shape. Button code should continue calling functions such as `createWorkspaceApi`, `loadWorkspaceApi`, `runStepApi`, `rtl2gdsApi`, `getInfoApi`, and `getHomePageApi`.

The renderer should not build CLI strings, import Node APIs, or manage child processes. Its only runtime boundary is the preload bridge.

## Error Handling

The adapter should return server-shaped results so existing renderer handling still works:

```ts
{
  ok: boolean
  cmd: DesktopCliCommandName
  response: 'success' | 'failed' | 'error' | 'warning' | 'cancelled'
  data: Record<string, unknown>
  message: string[]
}
```

Expected user-facing failures:

- No active workspace for a command requiring `--directory`.
- CLI executable not found.
- CLI returns non-zero without a JSON response.
- CLI returns invalid JSON.
- CLI returns `failed` or `error` response.

## Testing

Desktop Electron tests should cover:

- Each GUI command maps to the expected `ecc workspace` argv.
- `create_workspace` writes the expected input JSON request.
- `load_workspace` and `create_workspace` update active workspace after success.
- `run_step`, `rtl2gds`, `get_info`, and `home_page` use active workspace when request data omits `directory`.
- Missing directory returns a structured failed result.
- CLI stdout/stderr are forwarded as runtime events.
- Successful, warning, failed, and malformed CLI outputs are normalized correctly.
- Backend selection chooses API for `ECOS_RUNTIME_BACKEND=api` and CLI for `ECOS_RUNTIME_BACKEND=cli`.

ECC CLI tests already cover the current workspace commands and should remain the source of truth for CLI behavior.

## Non-Goals

- Do not remove FastAPI startup in the same change.
- Do not make renderer components call `ecc` directly.
- Do not move `chipcompiler` execution into Electron main.
- Do not redesign the terminal command path.
