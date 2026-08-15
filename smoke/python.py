"""Live smoke test: drives the Python client against the real API.

Uses a pk_test_ key, whose responses are static and match the production
schema, so this burns no quota and renders nothing. See smoke/node.mjs for the
coverage caveat: test keys reach POST /v1/render, GET /:jobId and
DELETE /:jobId only.
"""

from __future__ import annotations

import os
import sys

from pdfglyph import PDFGlyph, PDFGlyphError

api_key = os.environ.get("PDFGLYPH_TEST_KEY")
base_url = os.environ.get("PDFGLYPH_BASE_URL") or "https://pdfglyph.com"

if not api_key:
    print("PDFGLYPH_TEST_KEY is not set", file=sys.stderr)
    sys.exit(1)
if not api_key.startswith("pk_test_"):
    print(
        "Refusing to run: key is not a pk_test_ key (would bill real renders)",
        file=sys.stderr,
    )
    sys.exit(1)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


try:
    with PDFGlyph(api_key, base_url=base_url) as client:
        job = client.render(html="<h1>smoke</h1>")
        check("POST /v1/render returns a job_id", bool(job.job_id), job.job_id)
        check("POST /v1/render returns a status", bool(job.status), job.status)

        fetched = client.get_job(job.job_id)
        check("GET /v1/render/:jobId returns the job", bool(fetched.status), fetched.status)
        check(
            "camelCase response maps to snake_case fields",
            fetched.job_id == job.job_id,
            f"{fetched.job_id} == {job.job_id}",
        )

        cancel_error = None
        try:
            client.cancel_job(job.job_id)
        except PDFGlyphError as err:
            cancel_error = f"{err.status_code}: {err}"
        check(
            "DELETE /v1/render/:jobId completes without raising",
            cancel_error is None,
            cancel_error or "",
        )
except PDFGlyphError as err:
    check("smoke run completed", False, f"{err.status_code}: {err}")
except Exception as err:  # noqa: BLE001 - surface anything unexpected
    check("smoke run completed", False, str(err))

if failures:
    print(f"\n{len(failures)} check(s) failed: {', '.join(failures)}", file=sys.stderr)
    sys.exit(1)
print("\npython client: all checks passed")
