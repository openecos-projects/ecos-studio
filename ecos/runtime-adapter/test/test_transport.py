import pytest
from ecos_runtime_adapter.transport import (
    ContentLengthDecoder,
    TransportError,
    encode_content_length_frame,
)


def test_encodes_and_decodes_one_content_length_frame():
    frame = encode_content_length_frame(b'{"jsonrpc":"2.0","id":1}')

    assert frame.startswith(b"Content-Length: 24\r\n\r\n")
    decoder = ContentLengthDecoder()
    assert decoder.feed(frame) == [b'{"jsonrpc":"2.0","id":1}']


def test_decodes_multiple_frames_from_one_buffer():
    frame = encode_content_length_frame(b'{"id":1}') + encode_content_length_frame(b'{"id":2}')

    decoder = ContentLengthDecoder()

    assert decoder.feed(frame) == [b'{"id":1}', b'{"id":2}']


def test_buffers_partial_header_and_payload_until_complete():
    frame = encode_content_length_frame(b'{"id":1}')
    decoder = ContentLengthDecoder()

    assert decoder.feed(frame[:5]) == []
    assert decoder.feed(frame[5:20]) == []
    assert decoder.feed(frame[20:-1]) == []
    assert decoder.feed(frame[-1:]) == [b'{"id":1}']


def test_malformed_content_length_header_is_transport_error():
    decoder = ContentLengthDecoder()

    with pytest.raises(TransportError, match="Content-Length"):
        decoder.feed(b"Content-Length: nope\r\n\r\n{}")


def test_missing_content_length_header_is_transport_error():
    decoder = ContentLengthDecoder()

    with pytest.raises(TransportError, match="Content-Length"):
        decoder.feed(b"X-Length: 2\r\n\r\n{}")


def test_oversize_payload_is_transport_error():
    decoder = ContentLengthDecoder(max_payload_size=4)

    with pytest.raises(TransportError, match="exceeds"):
        decoder.feed(encode_content_length_frame(b"12345"))
