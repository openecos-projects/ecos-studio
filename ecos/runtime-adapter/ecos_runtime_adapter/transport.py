HEADER_SEPARATOR = b"\r\n\r\n"
DEFAULT_MAX_PAYLOAD_SIZE = 16 * 1024 * 1024


class TransportError(ValueError):
    """Raised when stdio framing is malformed before JSON-RPC dispatch."""


def encode_content_length_frame(payload: bytes | str) -> bytes:
    payload_bytes = payload.encode("utf-8") if isinstance(payload, str) else payload
    return b"Content-Length: %d\r\n\r\n" % len(payload_bytes) + payload_bytes


class ContentLengthDecoder:
    def __init__(self, *, max_payload_size: int = DEFAULT_MAX_PAYLOAD_SIZE):
        self._buffer = bytearray()
        self._max_payload_size = max_payload_size

    def feed(self, data: bytes) -> list[bytes]:
        self._buffer.extend(data)
        messages: list[bytes] = []

        while True:
            header_end = self._buffer.find(HEADER_SEPARATOR)
            if header_end < 0:
                return messages

            header = bytes(self._buffer[:header_end]).decode("ascii", errors="replace")
            content_length = self._parse_content_length(header)
            payload_start = header_end + len(HEADER_SEPARATOR)
            payload_end = payload_start + content_length
            if len(self._buffer) < payload_end:
                return messages

            messages.append(bytes(self._buffer[payload_start:payload_end]))
            del self._buffer[:payload_end]

    def _parse_content_length(self, header: str) -> int:
        length_values: list[str] = []
        for line in header.split("\r\n"):
            if not line:
                continue
            name, separator, value = line.partition(":")
            if not separator:
                raise TransportError("malformed header line before Content-Length")
            if name.lower() == "content-length":
                length_values.append(value.strip())

        if len(length_values) != 1:
            raise TransportError("exactly one Content-Length header is required")

        try:
            content_length = int(length_values[0])
        except ValueError as exc:
            raise TransportError("Content-Length must be an integer") from exc

        if content_length < 0:
            raise TransportError("Content-Length must be non-negative")
        if content_length > self._max_payload_size:
            raise TransportError("Content-Length exceeds maximum payload size")
        return content_length
