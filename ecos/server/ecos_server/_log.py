import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from time import localtime, strftime

_API_HANDLER_ATTR = "_ecos_api_handler"
_API_PREVIOUS_PROPAGATE_ATTR = "_ecos_api_previous_propagate"
_LEVEL_LABELS = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARN",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRIT",
}
_LEVEL_COLORS = {
    logging.DEBUG: "\x1b[90m",
    logging.INFO: "\x1b[36m",
    logging.WARNING: "\x1b[33m",
    logging.ERROR: "\x1b[31m",
    logging.CRITICAL: "\x1b[31;1m",
}
_RESET_COLOR = "\x1b[0m"


class _ApiLogFormatter(logging.Formatter):
    def __init__(self, *, color: bool = False, terminal: bool) -> None:
        super().__init__()
        self._color = color
        self._terminal = terminal

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        if record.exc_info:
            if not record.exc_text:
                record.exc_text = self.formatException(record.exc_info)
            message = f"{message}\n{record.exc_text}"
        if record.stack_info:
            message = f"{message}\n{self.formatStack(record.stack_info)}"

        prefix = self._prefix(record)
        return "\n".join(
            f"{prefix}{line}" if line else prefix.rstrip() for line in message.splitlines()
        )

    def _prefix(self, record: logging.LogRecord) -> str:
        label = _format_level(record.levelno, color=self._color)
        if self._terminal:
            timestamp = strftime("%H:%M:%S", localtime(record.created))
            return f"{timestamp} {label} [api] "
        timestamp = self.formatTime(record, "%Y-%m-%dT%H:%M:%S")
        return f"{timestamp} {label} [api] "


def _remove_handlers(log: logging.Logger, *, close: bool = True) -> None:
    for handler in list(log.handlers):
        log.removeHandler(handler)
        if close:
            handler.close()


def _mark_api_handler(handler: logging.Handler) -> logging.Handler:
    setattr(handler, _API_HANDLER_ATTR, True)
    return handler


def _remove_api_handlers(log: logging.Logger, *, close: bool = True) -> None:
    removed = False
    for handler in list(log.handlers):
        if not getattr(handler, _API_HANDLER_ATTR, False):
            continue
        log.removeHandler(handler)
        removed = True
        if close:
            handler.close()
    if removed and not any(getattr(handler, _API_HANDLER_ATTR, False) for handler in log.handlers):
        previous_propagate = getattr(log, _API_PREVIOUS_PROPAGATE_ATTR, True)
        log.propagate = previous_propagate
        if hasattr(log, _API_PREVIOUS_PROPAGATE_ATTR):
            delattr(log, _API_PREVIOUS_PROPAGATE_ATTR)


def _mirror_api_handlers_to_ecos_server(log: logging.Logger) -> None:
    namespace_log = logging.getLogger("ecos_server")
    _remove_api_handlers(namespace_log, close=False)
    setattr(namespace_log, _API_PREVIOUS_PROPAGATE_ATTR, namespace_log.propagate)
    for handler in log.handlers:
        namespace_log.addHandler(handler)
    namespace_log.setLevel(log.level)
    namespace_log.propagate = False


def _format_level(levelno: int, *, color: bool) -> str:
    label = _LEVEL_LABELS.get(levelno, logging.getLevelName(levelno)).ljust(5)
    if not color:
        return label
    return f"{_LEVEL_COLORS.get(levelno, '')}{label}{_RESET_COLOR}"


def _should_use_color(stream) -> bool:
    raw_mode = os.environ.get("ECOS_LOG_COLOR", "").strip().lower()
    if raw_mode == "always":
        return True
    if raw_mode == "never" or os.environ.get("NO_COLOR"):
        return False
    return bool(getattr(stream, "isatty", lambda: False)())


def ensure_api_logger(reset: bool = False) -> logging.Logger:
    log = logging.getLogger("ecos.api")
    if reset:
        _remove_api_handlers(logging.getLogger("ecos_server"), close=False)
        _remove_handlers(log)

    if not log.handlers:
        handler = _mark_api_handler(logging.StreamHandler(sys.stderr))
        handler.setFormatter(_ApiLogFormatter(color=_should_use_color(sys.stderr), terminal=True))
        log.addHandler(handler)

        log_file = os.environ.get("ECOS_API_LOG_FILE", "").strip()
        if log_file:
            os.makedirs(os.path.dirname(os.path.abspath(log_file)), exist_ok=True)
            formatter = _ApiLogFormatter(terminal=False)
            log_paths = _unique_paths(
                [
                    log_file,
                    os.environ.get("ECOS_API_LATEST_LOG_FILE", "").strip(),
                ]
            )
            for index, path in enumerate(log_paths):
                os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
                if index > 0:
                    open(path, "w", encoding="utf-8").close()
                file_handler = RotatingFileHandler(
                    path,
                    maxBytes=20 * 1024 * 1024,
                    backupCount=5,
                    encoding="utf-8",
                )
                _mark_api_handler(file_handler)
                file_handler.setFormatter(formatter)
                log.addHandler(file_handler)

        log.propagate = False
        level = os.environ.get("ECOS_API_LOG_LEVEL", "warning").upper()
        try:
            log.setLevel(level)
        except ValueError:
            log.setLevel(logging.WARNING)
        _mirror_api_handlers_to_ecos_server(log)
    return log


def _unique_paths(paths: list[str]) -> list[str]:
    seen = set()
    unique = []
    for path in paths:
        if not path:
            continue
        resolved = os.path.abspath(os.path.expanduser(path))
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(path)
    return unique
