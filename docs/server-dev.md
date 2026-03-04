# API Server Development

## Setup

From the repository root:

```bash
# Using uv (recommended)
uv venv ecos/server/.venv
uv pip install -e ecos/server --python ecos/server/.venv

# Or using standard venv
python -m venv ecos/server/.venv
ecos/server/.venv/bin/pip install -e ecos/server
```

## VS Code

Add to `.vscode/settings.json` in the repository root:

```json
{
  "python.defaultInterpreterPath": "ecos/server/.venv/bin/python"
}
```
