# pdfglyph

Official Python client for the [PDFGlyph API](https://pdfglyph.com) — render HTML
and CSS to pixel-perfect PDFs, or full-page screenshots, with one API call.

Requires Python 3.9+. The only dependency is `httpx`.

## Installation

```bash
pip install pdfglyph
```

## Getting an API key

This client talks to a hosted service and needs an account. The free tier is 100
renders a month with no card: sign up at [pdfglyph.com](https://pdfglyph.com) and
create a key in the dashboard. Keys are prefixed `pk_test_` or `pk_live_`.

## Quick start

```python
import os
from pdfglyph import PDFGlyph

with PDFGlyph(os.environ["PDFGLYPH_API_KEY"]) as client:
    # Synchronous render — PDF bytes come straight back
    result = client.render_sync(html="<h1>Hello World</h1>")
    with open("output.pdf", "wb") as f:
        f.write(result.pdf)
    print(f"Generated {result.page_count} page PDF")

    # Async render — submit a job, poll, download
    job = client.render(html="<h1>Hello World</h1>")
    client.wait_for_completion(job.job_id)
    pdf = client.download_pdf(job.job_id)
```

Using the client as a context manager closes its connection pool deterministically.
If you keep a long-lived client instead, call `client.close()` when you are done.

## Screenshots

Set `format` to `"png"` or `"jpeg"` and the same endpoint returns images instead of
a PDF. Pages are 1-based and match the order of `screenshot_urls`.

```python
job = client.render(html="<h1>Hi</h1>", format="png")
client.wait_for_completion(job.job_id)

shot = client.download_screenshot(job.job_id, page=1)
with open("page-1.png", "wb") as f:
    f.write(shot.image)
print(shot.content_type)  # "image/png"
```

## Webhooks

Pass `webhook_url` when submitting a job and PDFGlyph will POST to it on completion,
signed with HMAC-SHA256 in the `X-PDFGlyph-Signature` header. Verify against the raw
request body — parsing and re-serializing the JSON first will change the bytes and
break the signature.

```python
from pdfglyph import verify_webhook_signature

is_valid = verify_webhook_signature(
    payload=request.body.decode(),
    signature=request.headers["X-PDFGlyph-Signature"],
    secret=os.environ["PDFGLYPH_WEBHOOK_SECRET"],
)
```

## Errors

Any non-2xx response raises `PDFGlyphError`, carrying the server's message and the
HTTP status:

```python
from pdfglyph import PDFGlyphError

try:
    client.render_sync(html=html)
except PDFGlyphError as err:
    if err.status_code == 402:
        ...  # monthly quota exhausted
    raise
```

## API reference

### `PDFGlyph(api_key, base_url="https://api.pdfglyph.com", timeout=60.0, transport=None)`

`transport` accepts any `httpx.BaseTransport`, which makes the client easy to stub
in tests with `httpx.MockTransport`.

### Methods

| Method | Description |
| --- | --- |
| `render(html=None, url=None, css=None, **options)` | Submit an async render job |
| `render_sync(html=None, url=None, css=None, **options)` | Render now; returns `RenderSyncResult` |
| `get_job(job_id)` | Fetch job status |
| `cancel_job(job_id)` | Cancel a queued or processing job |
| `download_pdf(job_id)` | Download the finished PDF as `bytes` |
| `download_screenshot(job_id, page=1)` | Download one screenshot page (1-based); returns `ScreenshotResult` |
| `wait_for_completion(job_id, timeout=60.0, interval=1.0)` | Poll until terminal |
| `close()` | Close the connection pool |

Extra keyword arguments are passed through to the API: `format`, `landscape`,
`margins`, `header_template`, `footer_template`, `page_ranges`, `print_background`,
`webhook_url`.

### Result types

- `RenderSyncResult` — `pdf`, `render_time_ms`, `total_time_ms`, `page_count`, `file_size`
- `ScreenshotResult` — `image`, `content_type`
- `RenderJob` — `job_id`, `status`, `pdf_url`, `screenshot_urls`, `metadata`, `created_at`, `completed_at`, `expires_at`, `error`

## License

MIT
