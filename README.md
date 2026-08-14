# PDFGlyph clients

Official client libraries for the [PDFGlyph API](https://pdfglyph.com) — render HTML
and CSS to pixel-perfect PDFs, or full-page PNG/JPEG screenshots, with one API call.

| Language | Package | Directory |
| --- | --- | --- |
| Node.js | [`@pdfglyph/client`](https://www.npmjs.com/package/@pdfglyph/client) | [`node/`](node) |
| Python | [`pdfglyph`](https://pypi.org/project/pdfglyph/) | [`python/`](python) |

Both are thin wrappers over a plain HTTP API. You never need them — every endpoint
is reachable with `curl` or any HTTP client in any language — but they save you the
job of hand-rolling polling, webhook signature verification, and header parsing.

## Getting an API key

The clients talk to a hosted service, so they need an account. The free tier is 100
renders a month and does not ask for a card: sign up at
[pdfglyph.com](https://pdfglyph.com) and create a key in the dashboard. Keys are
prefixed `pk_test_` or `pk_live_`.

## Quick look

```javascript
import { PDFGlyph } from "@pdfglyph/client";

const client = new PDFGlyph(process.env.PDFGLYPH_API_KEY);
const { pdf } = await client.renderSync({ html: "<h1>Hello, PDF!</h1>" });
```

```python
from pdfglyph import PDFGlyph

with PDFGlyph(os.environ["PDFGLYPH_API_KEY"]) as client:
    pdf = client.render_sync(html="<h1>Hello, PDF!</h1>").pdf
```

See [`node/README.md`](node/README.md) and [`python/README.md`](python/README.md)
for the full API surface.

## Repository layout

This repository contains only the client libraries. The PDFGlyph service itself is
closed source and lives elsewhere; issues filed here should concern the clients.
For questions about the API, billing, or the service, use the support channels on
[pdfglyph.com](https://pdfglyph.com).

## Releases

Each package versions and ships independently, driven by a tag prefix:

```
client-node-v1.0.0     -> publishes @pdfglyph/client to npm
client-python-v1.0.0   -> publishes pdfglyph to PyPI
```

CI runs the full test suite for both packages on every pull request, and the release
workflow re-runs it before publishing. The tag version must match the version in
`package.json` / `pyproject.toml` or the release fails.

## Contributing

Bug reports and pull requests are welcome. Please run the tests before opening a PR:

```bash
cd node   && pnpm install && pnpm test
cd python && pip install -e ".[dev]" && pytest tests -q
```

## License

MIT — see [LICENSE](LICENSE).
