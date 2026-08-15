"""Tests for the PDFGlyph Python client."""

from __future__ import annotations

import hashlib
import hmac
from typing import Callable, Optional

import httpx
import pytest

from pdfglyph import (
    PDFGlyph,
    PDFGlyphError,
    verify_webhook_signature,
)

API_KEY = "pk_test_abc123"


def make_client(
    handler: Callable[[httpx.Request], httpx.Response],
    recorder: Optional[list[httpx.Request]] = None,
) -> PDFGlyph:
    """Build a client whose HTTP layer is backed by an in-memory handler."""

    def wrapped(request: httpx.Request) -> httpx.Response:
        if recorder is not None:
            recorder.append(request)
        return handler(request)

    return PDFGlyph(API_KEY, transport=httpx.MockTransport(wrapped))


def test_render_maps_camel_case_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            202,
            json={
                "jobId": "job_1",
                "status": "queued",
                "createdAt": "2026-08-14T00:00:00Z",
            },
        )

    with make_client(handler) as client:
        job = client.render(html="<h1>Hi</h1>")

    assert job.job_id == "job_1"
    assert job.status == "queued"
    assert job.created_at == "2026-08-14T00:00:00Z"


def test_render_sends_auth_header_and_body() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(202, json={"jobId": "j", "status": "queued"})

    with make_client(handler, recorder=seen) as client:
        client.render(html="<p>x</p>", css="p{color:red}", landscape=True)

    assert seen[0].headers["authorization"] == f"Bearer {API_KEY}"
    assert seen[0].url.path == "/v1/render"
    body = seen[0].read().decode()
    assert '"html"' in body and '"css"' in body and '"landscape"' in body


def test_render_sync_parses_metadata_headers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("sync") == "true"
        return httpx.Response(
            200,
            content=b"%PDF-1.7 fake",
            headers={
                "Content-Type": "application/pdf",
                "X-Render-Time-Ms": "128",
                "X-Total-Time-Ms": "155",
                "X-Page-Count": "3",
                "X-File-Size": "12345",
            },
        )

    with make_client(handler) as client:
        result = client.render_sync(html="<h1>Hi</h1>")

    assert result.pdf == b"%PDF-1.7 fake"
    assert result.render_time_ms == 128
    assert result.total_time_ms == 155
    assert result.page_count == 3
    assert result.file_size == 12345


def test_render_sync_defaults_missing_headers_to_zero() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"%PDF", headers={})

    with make_client(handler) as client:
        result = client.render_sync(html="<h1>Hi</h1>")

    assert result.page_count == 0
    assert result.render_time_ms == 0


def test_cancel_job_handles_204_no_content() -> None:
    """The server answers DELETE with 204 and an empty body."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        return httpx.Response(204)

    with make_client(handler) as client:
        assert client.cancel_job("job_1") is None


def test_download_pdf_returns_bytes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/render/job_1/download"
        return httpx.Response(200, content=b"%PDF-1.7 bytes")

    with make_client(handler) as client:
        assert client.download_pdf("job_1") == b"%PDF-1.7 bytes"


def test_download_screenshot_uses_one_based_page() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"\x89PNG", headers={"Content-Type": "image/png"}
        )

    with make_client(handler, recorder=seen) as client:
        shot = client.download_screenshot("job_1", page=2)

    assert seen[0].url.path == "/v1/render/job_1/screenshot/2"
    assert shot.image == b"\x89PNG"
    assert shot.content_type == "image/png"


def test_download_screenshot_defaults_to_first_page() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x", headers={"Content-Type": "image/jpeg"})

    with make_client(handler, recorder=seen) as client:
        client.download_screenshot("job_1")

    assert seen[0].url.path == "/v1/render/job_1/screenshot/1"


def test_error_response_raises_with_status_and_message() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "Monthly quota exceeded"})

    with make_client(handler) as client:
        with pytest.raises(PDFGlyphError) as excinfo:
            client.render(html="<h1>Hi</h1>")

    assert excinfo.value.status_code == 402
    assert "Monthly quota exceeded" in str(excinfo.value)


def test_error_response_without_json_body_falls_back() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"<html>oops</html>")

    with make_client(handler) as client:
        with pytest.raises(PDFGlyphError) as excinfo:
            client.render(html="<h1>Hi</h1>")

    assert excinfo.value.status_code == 500


def test_wait_for_completion_polls_until_terminal() -> None:
    statuses = iter(["queued", "processing", "completed"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"jobId": "j", "status": next(statuses)})

    with make_client(handler) as client:
        job = client.wait_for_completion("j", timeout=5.0, interval=0.0)

    assert job.status == "completed"


def test_wait_for_completion_times_out() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"jobId": "j", "status": "processing"})

    with make_client(handler) as client:
        with pytest.raises(PDFGlyphError) as excinfo:
            client.wait_for_completion("j", timeout=0.05, interval=0.01)

    assert excinfo.value.status_code == 408


def test_default_base_url_targets_the_real_api_host() -> None:
    """Regression: 1.0.0 defaulted to api.pdfglyph.com, which has no DNS record."""
    client = PDFGlyph(API_KEY)
    assert client.base_url == "https://pdfglyph.com"
    client.close()


def test_base_url_trailing_slash_is_stripped() -> None:
    client = PDFGlyph(API_KEY, base_url="https://api.example.com/")
    assert client.base_url == "https://api.example.com"
    client.close()


def test_close_is_idempotent() -> None:
    client = PDFGlyph(API_KEY)
    client.close()
    client.close()


class TestWebhookSignature:
    SECRET = "whsec_topsecret"
    PAYLOAD = '{"jobId":"job_1","status":"completed"}'

    def valid_signature(self) -> str:
        digest = hmac.new(
            self.SECRET.encode(), self.PAYLOAD.encode(), hashlib.sha256
        ).hexdigest()
        return f"sha256={digest}"

    def test_accepts_valid_signature(self) -> None:
        assert verify_webhook_signature(
            self.PAYLOAD, self.valid_signature(), self.SECRET
        )

    def test_rejects_tampered_payload(self) -> None:
        assert not verify_webhook_signature(
            self.PAYLOAD + " ", self.valid_signature(), self.SECRET
        )

    def test_rejects_wrong_secret(self) -> None:
        assert not verify_webhook_signature(
            self.PAYLOAD, self.valid_signature(), "whsec_wrong"
        )

    def test_rejects_signature_without_prefix(self) -> None:
        bare = self.valid_signature().removeprefix("sha256=")
        assert not verify_webhook_signature(self.PAYLOAD, bare, self.SECRET)

    def test_rejects_empty_signature(self) -> None:
        assert not verify_webhook_signature(self.PAYLOAD, "", self.SECRET)
