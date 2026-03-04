# API Server Development

## Setup

The API server depends on the `chipcompiler` package (ECC toolchain) via a uv workspace. Both packages are installed in editable mode, allowing you to modify ECC source code and debug directly.

From the repository root:

```bash
# Using uv (recommended)
uv venv ecos/server/.venv
uv sync --directory ecos/server --python ecos/server/.venv

# Or using standard pip
python -m venv ecos/server/.venv
ecos/server/.venv/bin/pip install -e ecos/server/ecc
ecos/server/.venv/bin/pip install -e ecos/server
```

Both `ecos-server` and `chipcompiler` are now installed in editable mode. Changes to either codebase take effect immediately without reinstalling.

## VS Code

Add to `.vscode/settings.json` in the repository root:

```json
{
  "python.defaultInterpreterPath": "ecos/server/.venv/bin/python"
}
```
