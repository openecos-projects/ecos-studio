#!/usr/bin/env python

"""PyInstaller entrypoint for the ECOS Studio desktop JSON CLI."""

from ecos_server.run_ecc_cli import main


if __name__ == "__main__":
    main()
