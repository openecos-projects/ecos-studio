"""PyInstaller entry point for the packaged ECOS Agent provider."""

from __future__ import annotations

import sys

from ecos_agent.provider import main


def entrypoint() -> int:
    if sys.argv[1:] == ["--version"]:
        print("ecos-agent")
        return 0
    return main()


if __name__ == "__main__":
    raise SystemExit(entrypoint())
