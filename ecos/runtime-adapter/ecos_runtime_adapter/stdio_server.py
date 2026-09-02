import os
import queue
import sys
import threading
from typing import BinaryIO

from ecos_runtime_adapter.server import RuntimeServer
from ecos_runtime_adapter.transport import (
    ContentLengthDecoder,
    TransportError,
    encode_content_length_frame,
)

_STOP = object()


class _ProtocolWriter:
    """Serialize protocol output through an fd immune to tool stdio redirects."""

    def __init__(self, output_stream: BinaryIO):
        self._output_stream = output_stream
        self._output_fd: int | None = None
        try:
            self._output_fd = os.dup(output_stream.fileno())
        except (AttributeError, OSError):
            # BytesIO is used by unit tests and has no file descriptor.
            self._output_fd = None
        self._messages: queue.Queue[bytes | object] = queue.Queue()
        self._thread = threading.Thread(target=self._write_loop, name="ecc-rpc-writer", daemon=True)
        self._thread.start()

    def send_response(self, response: str) -> None:
        self._messages.put(encode_content_length_frame(response))

    def send_notification(self, method: str, params: dict) -> None:
        import json

        payload = json.dumps(
            {"jsonrpc": "2.0", "method": method, "params": params},
            separators=(",", ":"),
        )
        self._messages.put(encode_content_length_frame(payload))

    def close(self) -> None:
        self._messages.put(_STOP)
        self._thread.join()
        if self._output_fd is not None:
            os.close(self._output_fd)
            self._output_fd = None

    def _write_loop(self) -> None:
        while True:
            message = self._messages.get()
            if message is _STOP:
                return
            assert isinstance(message, bytes)
            if self._output_fd is None:
                self._output_stream.write(message)
                self._output_stream.flush()
                continue
            _write_all(self._output_fd, message)


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        view = view[written:]


def run_stdio_server(
    input_stream: BinaryIO,
    output_stream: BinaryIO,
    *,
    server: RuntimeServer | None = None,
    persistent_db_enabled: bool = False,
) -> int:
    runtime_server = server or RuntimeServer(persistent_db_enabled=persistent_db_enabled)
    decoder = ContentLengthDecoder()
    writer = _ProtocolWriter(output_stream)
    runtime_server.set_notification_sink(writer.send_notification)

    try:
        while True:
            chunk = _read_chunk(input_stream)
            if not chunk:
                break
            try:
                messages = decoder.feed(chunk)
            except TransportError as exc:
                print(f"transport error: {exc}", file=sys.stderr)
                return 1

            for message in messages:
                response = runtime_server.dispatch(message)
                if response:
                    writer.send_response(response)
        return 0
    finally:
        runtime_server.set_notification_sink(None)
        writer.close()


def _read_chunk(input_stream: BinaryIO) -> bytes:
    read1 = getattr(input_stream, "read1", None)
    if read1 is not None:
        return read1(8192)
    return input_stream.read(8192)


def main(*, persistent_db_enabled: bool = False) -> int:
    return run_stdio_server(
        sys.stdin.buffer,
        sys.stdout.buffer,
        persistent_db_enabled=persistent_db_enabled,
    )
