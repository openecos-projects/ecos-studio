import importlib
import logging
import re


def _reset_api_logging_state(*loggers: logging.Logger) -> None:
    for logger in loggers:
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)
        logger.setLevel(logging.NOTSET)
    logging.getLogger("ecos_server").propagate = True


def test_api_logger_writes_plain_records_to_file(tmp_path, monkeypatch):
    log_file = tmp_path / "api-server.log"
    monkeypatch.setenv("ECOS_API_LOG_FILE", str(log_file))
    monkeypatch.setenv("ECOS_API_LOG_LEVEL", "debug")

    log_module = importlib.import_module("ecos_server._log")
    logger = log_module.ensure_api_logger(reset=True)

    logger.debug("[API_PHASE] process_started")
    logger.warning("[API_WARN] ready took longer than expected")

    content = log_file.read_text()
    assert "[API_PHASE] process_started" in content
    assert "[API_WARN] ready took longer than expected" in content
    assert "\x1b[" not in content

    _reset_api_logging_state(logger, logging.getLogger("ecos_server"))


def test_api_logger_mirrors_records_to_latest_file(tmp_path, monkeypatch):
    session_log_file = tmp_path / "sessions" / "20260512-223000-1234" / "api-server.log"
    latest_log_file = tmp_path / "api-server.log"
    latest_log_file.write_text("old launch\n")
    monkeypatch.setenv("ECOS_API_LOG_FILE", str(session_log_file))
    monkeypatch.setenv("ECOS_API_LATEST_LOG_FILE", str(latest_log_file))
    monkeypatch.setenv("ECOS_API_LOG_LEVEL", "debug")

    log_module = importlib.import_module("ecos_server._log")
    logger = log_module.ensure_api_logger(reset=True)

    logger.info("[API_START] session scoped")

    session_content = session_log_file.read_text()
    latest_content = latest_log_file.read_text()
    assert "[API_START] session scoped" in session_content
    assert latest_content == session_content
    assert "old launch" not in latest_content

    _reset_api_logging_state(logger, logging.getLogger("ecos_server"))


def test_api_logger_formats_ecos_server_module_logs_for_terminal(monkeypatch, capsys):
    monkeypatch.delenv("ECOS_API_LOG_FILE", raising=False)
    monkeypatch.delenv("ECOS_API_LATEST_LOG_FILE", raising=False)
    monkeypatch.setenv("ECOS_API_LOG_LEVEL", "debug")

    log_module = importlib.import_module("ecos_server._log")
    api_logger = log_module.ensure_api_logger(reset=True)
    registry_logger = logging.getLogger("ecos_server.resource.registry")

    registry_logger.warning("Failed to fetch registry from %s", "https://registry.example")

    captured = capsys.readouterr()
    assert re.search(
        r"\d{2}:\d{2}:\d{2} WARN\s+\[api\] Failed to fetch registry from https://registry\.example",
        captured.err,
    )

    _reset_api_logging_state(api_logger, logging.getLogger("ecos_server"))


def test_api_logger_colors_terminal_level_when_enabled(monkeypatch, capsys):
    monkeypatch.delenv("ECOS_API_LOG_FILE", raising=False)
    monkeypatch.delenv("ECOS_API_LATEST_LOG_FILE", raising=False)
    monkeypatch.setenv("ECOS_API_LOG_LEVEL", "debug")
    monkeypatch.setenv("ECOS_LOG_COLOR", "always")

    log_module = importlib.import_module("ecos_server._log")
    api_logger = log_module.ensure_api_logger(reset=True)

    api_logger.warning("Registry unavailable")

    captured = capsys.readouterr()
    assert "\x1b[33mWARN " in captured.err
    assert "\x1b[0m [api] Registry unavailable" in captured.err

    _reset_api_logging_state(api_logger, logging.getLogger("ecos_server"))


def test_api_logger_removing_mirrored_handlers_restores_ecos_server_propagation(
    monkeypatch,
):
    monkeypatch.delenv("ECOS_API_LOG_FILE", raising=False)
    monkeypatch.delenv("ECOS_API_LATEST_LOG_FILE", raising=False)

    log_module = importlib.import_module("ecos_server._log")
    api_logger = log_module.ensure_api_logger(reset=True)
    namespace_logger = logging.getLogger("ecos_server")
    assert namespace_logger.propagate is False

    log_module._remove_api_handlers(namespace_logger, close=False)

    assert namespace_logger.propagate is True
    _reset_api_logging_state(api_logger, namespace_logger)


def test_api_logger_restores_existing_ecos_server_propagation_setting(monkeypatch):
    monkeypatch.delenv("ECOS_API_LOG_FILE", raising=False)
    monkeypatch.delenv("ECOS_API_LATEST_LOG_FILE", raising=False)

    log_module = importlib.import_module("ecos_server._log")
    namespace_logger = logging.getLogger("ecos_server")
    namespace_logger.propagate = False

    api_logger = log_module.ensure_api_logger(reset=True)
    assert namespace_logger.propagate is False

    log_module._remove_api_handlers(namespace_logger, close=False)

    assert namespace_logger.propagate is False
    _reset_api_logging_state(api_logger, namespace_logger)
