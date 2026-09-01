import argparse

from ecos_runtime_adapter.stdio_server import main as run_stdio_adapter


def main() -> int:
    parser = argparse.ArgumentParser(prog="ecos-ecc-runtime-adapter")
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--persistent-db", action="store_true")
    args = parser.parse_args()
    if not args.stdio:
        parser.error("--stdio is required")
    return run_stdio_adapter(persistent_db_enabled=args.persistent_db)


if __name__ == "__main__":
    raise SystemExit(main())
