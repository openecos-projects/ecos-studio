import logging
import os
import sys


def ensure_api_logger() -> logging.Logger:
    log = logging.getLogger("ecos.api")
    if not log.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(handler)
        log.propagate = False
        level = os.environ.get("ECOS_API_LOG_LEVEL", "warning").upper()
        try:
            log.setLevel(level)
        except ValueError:
            log.setLevel(logging.WARNING)
    return log
