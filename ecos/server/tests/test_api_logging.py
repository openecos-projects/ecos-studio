import importlib
import logging


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

    for handler in list(logger.handlers):
        handler.close()
        logger.removeHandler(handler)
    logger.setLevel(logging.NOTSET)


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

    for handler in list(logger.handlers):
        handler.close()
        logger.removeHandler(handler)
    logger.setLevel(logging.NOTSET)
