"""PDFGlyph API client."""

from __future__ import annotations

import time
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Optional, Type

import httpx


class PDFGlyphError(Exception):
    """Error from the PDFGlyph API."""

    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class RenderSyncResult:
    """Result of a synchronous render call."""

    pdf: bytes
    render_time_ms: int
    total_time_ms: int
    page_count: int
    file_size: int


@dataclass
class ScreenshotResult:
    """A single screenshot page downloaded from a completed job."""

    image: bytes
    content_type: str


@dataclass
class RenderJob:
    """Represents a render job."""

    job_id: str
    status: str
    pdf_url: Optional[str] = None
    screenshot_urls: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
    expires_at: Optional[str] = None
    error: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RenderJob:
        return cls(
            job_id=data.get("jobId", ""),
            status=data.get("status", ""),
            pdf_url=data.get("pdfUrl"),
            screenshot_urls=data.get("screenshotUrls"),
            metadata=data.get("metadata"),
            created_at=data.get("createdAt"),
            completed_at=data.get("completedAt"),
            expires_at=data.get("expiresAt"),
            error=data.get("error"),
        )


class PDFGlyph:
    """Official Python client for the PDFGlyph API.

    Usable as a context manager, which closes the underlying connection pool
    deterministically::

        with PDFGlyph("pk_live_...") as client:
            pdf = client.render_sync(html="<h1>Hi</h1>").pdf
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://pdfglyph.com",
        timeout: float = 60.0,
        transport: Optional[httpx.BaseTransport] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        client = getattr(self, "_client", None)
        if client is not None:
            client.close()

    def __enter__(self) -> PDFGlyph:
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    def __del__(self) -> None:
        # __init__ may have raised before _client was assigned, so this must
        # not assume the attribute exists.
        try:
            self.close()
        except Exception:
            pass

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = self._client.request(method, path, **kwargs)
        if not response.is_success:
            try:
                error_data = response.json()
                message = error_data.get("error", response.reason_phrase)
            except Exception:
                message = response.reason_phrase or f"HTTP {response.status_code}"
            raise PDFGlyphError(message, response.status_code)
        return response

    @staticmethod
    def _body(
        html: Optional[str],
        url: Optional[str],
        css: Optional[str],
        options: dict[str, Any],
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if html is not None:
            body["html"] = html
        if url is not None:
            body["url"] = url
        if css is not None:
            body["css"] = css
        body.update(options)
        return body

    def render(
        self,
        html: Optional[str] = None,
        url: Optional[str] = None,
        css: Optional[str] = None,
        **options: Any,
    ) -> RenderJob:
        """Submit an async render job."""
        response = self._request(
            "POST", "/v1/render", json=self._body(html, url, css, options)
        )
        return RenderJob.from_dict(response.json())

    def render_sync(
        self,
        html: Optional[str] = None,
        url: Optional[str] = None,
        css: Optional[str] = None,
        **options: Any,
    ) -> RenderSyncResult:
        """Render synchronously and return PDF bytes plus timing info."""
        response = self._request(
            "POST", "/v1/render?sync=true", json=self._body(html, url, css, options)
        )
        headers = response.headers
        return RenderSyncResult(
            pdf=response.content,
            render_time_ms=int(headers.get("x-render-time-ms", "0")),
            total_time_ms=int(headers.get("x-total-time-ms", "0")),
            page_count=int(headers.get("x-page-count", "0")),
            file_size=int(headers.get("x-file-size", "0")),
        )

    def get_job(self, job_id: str) -> RenderJob:
        """Get the status of a render job."""
        response = self._request("GET", f"/v1/render/{job_id}")
        return RenderJob.from_dict(response.json())

    def cancel_job(self, job_id: str) -> None:
        """Cancel a queued or processing job."""
        self._request("DELETE", f"/v1/render/{job_id}")

    def download_pdf(self, job_id: str) -> bytes:
        """Download the PDF for a completed job."""
        response = self._request("GET", f"/v1/render/{job_id}/download")
        return response.content

    def download_screenshot(self, job_id: str, page: int = 1) -> ScreenshotResult:
        """Download one page of a completed screenshot job.

        Args:
            job_id: The completed job's ID.
            page: 1-based page number, matching the order of ``screenshot_urls``.
        """
        response = self._request("GET", f"/v1/render/{job_id}/screenshot/{page}")
        return ScreenshotResult(
            image=response.content,
            content_type=response.headers.get(
                "content-type", "application/octet-stream"
            ),
        )

    def wait_for_completion(
        self,
        job_id: str,
        timeout: float = 60.0,
        interval: float = 1.0,
    ) -> RenderJob:
        """Poll until the job completes, fails, or times out."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.get_job(job_id)
            if job.status in ("completed", "failed", "canceled", "cancelled", "expired"):
                return job
            time.sleep(interval)
        raise PDFGlyphError("Timeout waiting for render completion", 408)
