# @pdfglyph/client

Official Node.js client for the [PDFGlyph API](https://pdfglyph.com) — render HTML
and CSS to pixel-perfect PDFs, or full-page screenshots, with one API call.

Ships both ESM and CommonJS builds with TypeScript types. No runtime dependencies.
Requires Node 20 or newer (it uses the global `fetch`).

## Installation

```bash
npm install @pdfglyph/client
```

## Getting an API key

This client talks to a hosted service and needs an account. The free tier is 100
renders a month with no card: sign up at [pdfglyph.com](https://pdfglyph.com) and
create a key in the dashboard. Keys are prefixed `pk_test_` or `pk_live_`.

## Quick start

```javascript
import { PDFGlyph } from "@pdfglyph/client";
import fs from "node:fs";

const client = new PDFGlyph(process.env.PDFGLYPH_API_KEY);

// Synchronous render — PDF bytes come straight back
const { pdf, pageCount } = await client.renderSync({
  html: "<h1>Hello World</h1>",
});
fs.writeFileSync("output.pdf", pdf);
console.log(`Generated ${pageCount} page PDF`);

// Async render — submit a job, poll, download
const job = await client.render({ html: "<h1>Hello World</h1>" });
await client.waitForCompletion(job.jobId);
const bytes = await client.downloadPdf(job.jobId);
```

CommonJS works too:

```javascript
const { PDFGlyph } = require("@pdfglyph/client");
```

## Screenshots

Set `format` to `png` or `jpeg` and the same endpoint returns images instead of a
PDF. Pages are 1-based and match the order of `screenshotUrls`.

```javascript
const job = await client.render({ html: "<h1>Hi</h1>" }, { format: "png" });
await client.waitForCompletion(job.jobId);

const { image, contentType } = await client.downloadScreenshot(job.jobId, 1);
fs.writeFileSync("page-1.png", image);
```

## Webhooks

Pass `webhookUrl` when submitting a job and PDFGlyph will POST to it on completion,
signed with HMAC-SHA256 in the `X-PDFGlyph-Signature` header. Verify against the raw
request body — parsing and re-serializing the JSON first will change the bytes and
break the signature.

```javascript
const isValid = PDFGlyph.verifyWebhookSignature(
  rawBody,
  req.headers["x-pdfglyph-signature"],
  process.env.PDFGLYPH_WEBHOOK_SECRET,
);
```

## Errors

Any non-2xx response throws a `PDFGlyphError` carrying the server's message and the
HTTP status:

```javascript
import { PDFGlyphError } from "@pdfglyph/client";

try {
  await client.renderSync({ html });
} catch (err) {
  if (err instanceof PDFGlyphError && err.statusCode === 402) {
    // monthly quota exhausted
  }
  throw err;
}
```

## API reference

### `new PDFGlyph(apiKey, options?)`

- `apiKey` — your API key (`pk_live_*` or `pk_test_*`)
- `options.baseUrl` — override the API base URL (default `https://api.pdfglyph.com`)

### Methods

| Method | Description |
| --- | --- |
| `render(input, options?)` | Submit an async render job |
| `renderSync(input, options?)` | Render now; resolves to `{ pdf, pageCount, fileSize, renderTimeMs, totalTimeMs }` |
| `getJob(jobId)` | Fetch job status |
| `cancelJob(jobId)` | Cancel a queued or processing job |
| `downloadPdf(jobId)` | Download the finished PDF as a `Buffer` |
| `downloadScreenshot(jobId, page?)` | Download one screenshot page (1-based); resolves to `{ image, contentType }` |
| `waitForCompletion(jobId, options?)` | Poll until terminal; `options.timeout` (ms, default 60000) and `options.interval` (ms, default 1000) |

`input` accepts `html`, `css`, and `url`. `options` accepts `format`, `landscape`,
`margins`, `headerTemplate`, `footerTemplate`, `pageRanges`, `printBackground`, and
`webhookUrl`.

### Static methods

- `PDFGlyph.verifyWebhookSignature(payload, signature, secret)` — constant-time HMAC check, returns a boolean

## License

MIT
