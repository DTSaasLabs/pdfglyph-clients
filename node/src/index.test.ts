import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFGlyph, PDFGlyphError } from "./index.js";

const API_KEY = "pk_test_abc123";
const BASE_URL = "https://api.example.test";

type FetchCall = { url: string; init: RequestInit };

let calls: FetchCall[] = [];

/** Stub global fetch with a queue of responses, recording each request. */
function stubFetch(...responses: Response[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (!next) throw new Error("no stubbed response left");
      // Responses are single-use; clone so repeated polls can read the body.
      return next.clone();
    }),
  );
}

function client(): PDFGlyph {
  return new PDFGlyph(API_KEY, { baseUrl: BASE_URL });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("default base URL", () => {
  // Regression: 1.0.0 shipped defaulting to https://api.pdfglyph.com, a host
  // with no DNS record, so every install failed on the first call.
  it("targets the host that actually serves the API", async () => {
    stubFetch(json({ jobId: "j", status: "queued" }, 202));

    await new PDFGlyph(API_KEY).render({ html: "<h1>x</h1>" });

    expect(calls[0].url).toBe("https://pdfglyph.com/v1/render");
  });
});

describe("render", () => {
  it("posts to /v1/render with the bearer token", async () => {
    stubFetch(json({ jobId: "job_1", status: "queued" }, 202));

    const job = await client().render({ html: "<h1>Hi</h1>" });

    expect(job.jobId).toBe("job_1");
    expect(job.status).toBe("queued");
    expect(calls[0].url).toBe(`${BASE_URL}/v1/render`);
    expect(calls[0].init.method).toBe("POST");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${API_KEY}`);
  });

  it("merges input and options into a single body", async () => {
    stubFetch(json({ jobId: "j", status: "queued" }, 202));

    await client().render(
      { html: "<p>x</p>", css: "p{color:red}" },
      { landscape: true, printBackground: true },
    );

    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      html: "<p>x</p>",
      css: "p{color:red}",
      landscape: true,
      printBackground: true,
    });
  });
});

describe("renderSync", () => {
  it("parses the metadata headers", async () => {
    stubFetch(
      new Response(Buffer.from("%PDF-1.7 fake"), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "X-Render-Time-Ms": "128",
          "X-Total-Time-Ms": "155",
          "X-Page-Count": "3",
          "X-File-Size": "12345",
        },
      }),
    );

    const result = await client().renderSync({ html: "<h1>Hi</h1>" });

    expect(result.pdf.toString()).toBe("%PDF-1.7 fake");
    expect(result.renderTimeMs).toBe(128);
    expect(result.totalTimeMs).toBe(155);
    expect(result.pageCount).toBe(3);
    expect(result.fileSize).toBe(12345);
    expect(calls[0].url).toBe(`${BASE_URL}/v1/render?sync=true`);
  });

  it("defaults missing headers to zero", async () => {
    stubFetch(new Response(Buffer.from("%PDF"), { status: 200 }));

    const result = await client().renderSync({ html: "<h1>Hi</h1>" });

    expect(result.pageCount).toBe(0);
    expect(result.renderTimeMs).toBe(0);
  });
});

describe("cancelJob", () => {
  it("handles a 204 No Content response without throwing", async () => {
    // Regression: the client used to call response.json() unconditionally,
    // which throws on the empty body the server returns for DELETE.
    stubFetch(new Response(null, { status: 204 }));

    await expect(client().cancelJob("job_1")).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe(`${BASE_URL}/v1/render/job_1`);
  });
});

describe("downloadPdf", () => {
  it("returns the raw bytes", async () => {
    stubFetch(new Response(Buffer.from("%PDF-1.7 bytes"), { status: 200 }));

    const pdf = await client().downloadPdf("job_1");

    expect(pdf.toString()).toBe("%PDF-1.7 bytes");
    expect(calls[0].url).toBe(`${BASE_URL}/v1/render/job_1/download`);
  });
});

describe("downloadScreenshot", () => {
  it("uses a 1-based page number and surfaces the content type", async () => {
    stubFetch(
      new Response(Buffer.from("PNGDATA"), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );

    const shot = await client().downloadScreenshot("job_1", 2);

    expect(calls[0].url).toBe(`${BASE_URL}/v1/render/job_1/screenshot/2`);
    expect(shot.image.toString()).toBe("PNGDATA");
    expect(shot.contentType).toBe("image/png");
  });

  it("defaults to the first page", async () => {
    stubFetch(
      new Response(Buffer.from("x"), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }),
    );

    await client().downloadScreenshot("job_1");

    expect(calls[0].url).toBe(`${BASE_URL}/v1/render/job_1/screenshot/1`);
  });
});

describe("error handling", () => {
  it("raises PDFGlyphError with the server message and status", async () => {
    stubFetch(json({ error: "Monthly quota exceeded" }, 402));

    await expect(client().render({ html: "<h1>Hi</h1>" })).rejects.toThrow(
      PDFGlyphError,
    );

    stubFetch(json({ error: "Monthly quota exceeded" }, 402));
    await client()
      .render({ html: "<h1>Hi</h1>" })
      .catch((err: PDFGlyphError) => {
        expect(err.statusCode).toBe(402);
        expect(err.message).toBe("Monthly quota exceeded");
      });
  });

  it("falls back to the status text when the body is not JSON", async () => {
    stubFetch(new Response("<html>oops</html>", { status: 500 }));

    await client()
      .render({ html: "<h1>Hi</h1>" })
      .catch((err: PDFGlyphError) => {
        expect(err.statusCode).toBe(500);
      });
  });
});

describe("waitForCompletion", () => {
  it("polls until the job reaches a terminal state", async () => {
    stubFetch(
      json({ jobId: "j", status: "processing" }),
      json({ jobId: "j", status: "completed" }),
    );

    const job = await client().waitForCompletion("j", {
      timeout: 5000,
      interval: 0,
    });

    expect(job.status).toBe("completed");
  });

  it("throws a 408 once the timeout elapses", async () => {
    stubFetch(json({ jobId: "j", status: "processing" }));

    await client()
      .waitForCompletion("j", { timeout: 30, interval: 5 })
      .catch((err: PDFGlyphError) => {
        expect(err.statusCode).toBe(408);
      });
  });
});

describe("verifyWebhookSignature", () => {
  const SECRET = "whsec_topsecret";
  const PAYLOAD = '{"jobId":"job_1","status":"completed"}';
  const valid = `sha256=${crypto
    .createHmac("sha256", SECRET)
    .update(PAYLOAD)
    .digest("hex")}`;

  it("accepts a valid signature", () => {
    expect(PDFGlyph.verifyWebhookSignature(PAYLOAD, valid, SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(PDFGlyph.verifyWebhookSignature(`${PAYLOAD} `, valid, SECRET)).toBe(
      false,
    );
  });

  it("rejects a wrong secret", () => {
    expect(
      PDFGlyph.verifyWebhookSignature(PAYLOAD, valid, "whsec_wrong"),
    ).toBe(false);
  });

  it("rejects a signature missing the sha256= prefix", () => {
    expect(
      PDFGlyph.verifyWebhookSignature(
        PAYLOAD,
        valid.replace("sha256=", ""),
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects an empty signature without throwing", () => {
    expect(PDFGlyph.verifyWebhookSignature(PAYLOAD, "", SECRET)).toBe(false);
  });
});
