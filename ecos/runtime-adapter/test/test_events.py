import os
import sys
import threading
from contextlib import nullcontext

import pytest
from chipcompiler.utility.log import capture_stdio_to_file
from ecos_runtime_adapter.events import redirect_stdout_to_stderr


def test_redirect_stdout_to_stderr_restores_fd_1_and_fd_2(tmp_path):
    stdout_target = tmp_path / "stdout.txt"
    stderr_target = tmp_path / "stderr.txt"
    redirected_target = tmp_path / "redirected.txt"

    saved_stdout_fd = os.dup(1)
    saved_stderr_fd = os.dup(2)
    with open(stdout_target, "wb") as stdout_file, open(stderr_target, "wb") as stderr_file:
        os.dup2(stdout_file.fileno(), 1)
        os.dup2(stderr_file.fileno(), 2)
        try:
            with redirect_stdout_to_stderr(), open(redirected_target, "wb") as redirected_file:
                os.dup2(redirected_file.fileno(), 2)
                os.write(1, b"captured stdout\n")
                os.write(2, b"captured stderr\n")

            os.write(1, b"restored stdout\n")
            os.write(2, b"restored stderr\n")
        finally:
            os.dup2(saved_stdout_fd, 1)
            os.dup2(saved_stderr_fd, 2)
            os.close(saved_stdout_fd)
            os.close(saved_stderr_fd)
            sys.stdout = sys.__stdout__
            sys.stderr = sys.__stderr__

    assert stdout_target.read_text() == "restored stdout\n"
    assert stderr_target.read_text() == "captured stdout\nrestored stderr\n"
    assert redirected_target.read_text() == "captured stderr\n"


@pytest.mark.parametrize("error", [None, RuntimeError("failed"), SystemExit(0)])
def test_capture_stdio_to_file_restores_fd_1_and_fd_2(tmp_path, error):
    original_fds = (os.dup(1), os.dup(2))
    stdout_target = tmp_path / "stdout.txt"
    stderr_target = tmp_path / "stderr.txt"
    step_log = tmp_path / "step.log"
    with open(stdout_target, "wb") as stdout_file, open(stderr_target, "wb") as stderr_file:
        os.dup2(stdout_file.fileno(), 1)
        os.dup2(stderr_file.fileno(), 2)
        try:
            with (
                pytest.raises(type(error)) if error else nullcontext(),
                capture_stdio_to_file(str(step_log)),
            ):
                os.write(1, b"step stdout\n")
                os.write(2, b"step stderr\n")
                if error:
                    raise error
            os.write(1, b"restored stdout\n")
            os.write(2, b"restored stderr\n")
        finally:
            os.dup2(original_fds[0], 1)
            os.dup2(original_fds[1], 2)
            os.close(original_fds[0])
            os.close(original_fds[1])

    assert step_log.read_text() == "step stdout\nstep stderr\n"
    assert stdout_target.read_text() == "restored stdout\n"
    assert stderr_target.read_text() == "restored stderr\n"


def test_capture_stdio_to_file_serializes_process_fds(tmp_path):
    first_entered = threading.Event()
    second_attempted = threading.Event()
    second_entered = threading.Event()
    release_first = threading.Event()

    def capture_first():
        with capture_stdio_to_file(str(tmp_path / "first.log")):
            os.write(1, b"first\n")
            first_entered.set()
            release_first.wait(timeout=2)

    def capture_second():
        first_entered.wait(timeout=2)
        second_attempted.set()
        with capture_stdio_to_file(str(tmp_path / "second.log")):
            second_entered.set()
            os.write(1, b"second\n")

    first = threading.Thread(target=capture_first)
    second = threading.Thread(target=capture_second)
    first.start()
    second.start()
    try:
        assert first_entered.wait(timeout=2)
        assert second_attempted.wait(timeout=2)
        assert not second_entered.wait(timeout=0.05)
    finally:
        release_first.set()
        first.join(timeout=2)
        second.join(timeout=2)

    assert not first.is_alive()
    assert not second.is_alive()
    assert second_entered.is_set()
    assert (tmp_path / "first.log").read_text() == "first\n"
    assert (tmp_path / "second.log").read_text() == "second\n"


def test_rpc_redirect_does_not_restore_step_capture_after_capture_exits(tmp_path):
    original_fds = (os.dup(1), os.dup(2))
    stdout_target = tmp_path / "stdout.txt"
    stderr_target = tmp_path / "stderr.txt"
    step_log = tmp_path / "step.log"
    capture_entered = threading.Event()
    release_capture = threading.Event()
    capture_exited = threading.Event()

    def capture_step():
        with capture_stdio_to_file(str(step_log)):
            capture_entered.set()
            release_capture.wait(timeout=2)
        capture_exited.set()

    def dispatch_rpc():
        capture_entered.wait(timeout=2)
        with redirect_stdout_to_stderr():
            release_capture.set()
            capture_exited.wait(timeout=2)

    with open(stdout_target, "wb") as stdout_file, open(stderr_target, "wb") as stderr_file:
        os.dup2(stdout_file.fileno(), 1)
        os.dup2(stderr_file.fileno(), 2)
        first = threading.Thread(target=capture_step)
        second = threading.Thread(target=dispatch_rpc)
        try:
            first.start()
            second.start()
            first.join(timeout=2)
            second.join(timeout=2)
            assert not first.is_alive()
            assert not second.is_alive()
            os.write(1, b"after capture\n")
        finally:
            os.dup2(original_fds[0], 1)
            os.dup2(original_fds[1], 2)
            os.close(original_fds[0])
            os.close(original_fds[1])
            sys.stdout = sys.__stdout__
            sys.stderr = sys.__stderr__

    assert stdout_target.read_text() == "after capture\n"
    assert "after capture" not in step_log.read_text()
