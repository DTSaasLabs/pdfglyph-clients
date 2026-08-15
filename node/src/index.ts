import crypto from "node:crypto";

// Types
export interface RenderInput {
  html?: string;
  css?: string;
  url?: string;
}

export interface RenderOptions {
  format?: string;
  landscape?: boolean;
  margins?: { top: string; right: string; bottom: string; left: string };
  headerTemplate?: string;
  footerTemplate?: string;
  pageRanges?: string;
  printBackground?: boolean;
  webhookUrl?: string;
}

export interface RenderJob {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "canceled";
  pdfUrl?: string;
  screenshotUrls?: string[];
  metadata?: {
    pageCount: number;
    fileSize: number;
    renderTimeMs: number;
    totalTimeMs: number;
  };
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
  error?: string;
}

export interface RenderSyncResult {
  pdf: Buffer;
  pageCount: number;
  fileSize: number;
  renderTimeMs: number;
  totalTimeMs: number;
}

export interface ScreenshotResult {
  image: Buffer;
  /** "image/png" or "image/jpeg", depending on the format the job was rendered with. */
  contentType: string;
}

export interface PDFGlyphOptions {
  baseUrl?: string;
}

// Client
export class PDFGlyph {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, options?: PDFGlyphOptions) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl ?? "https://pdfglyph.com";
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new PDFGlyphError(
        (error as { error?: string }).error ?? response.statusText,
        response.status,
      );
    }

    return response;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.send(method, path, body);

    // Endpoints such as DELETE /v1/render/:jobId answer 204 with no body,
    // and response.json() would throw on the empty payload.
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async requestRaw(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{
    buffer: Buffer;
    headers: Record<string, string>;
  }> {
    const response = await this.send(method, path, body);

    const arrayBuffer = await response.arrayBuffer();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { buffer: Buffer.from(arrayBuffer), headers };
  }

  /** Submit an async render job */
  async render(
    input: RenderInput,
    options?: RenderOptions,
  ): Promise<RenderJob> {
    return this.request<RenderJob>("POST", "/v1/render", {
      ...input,
      ...options,
    });
  }

  /** Render synchronously — returns PDF buffer directly */
  async renderSync(
    input: RenderInput,
    options?: RenderOptions,
  ): Promise<RenderSyncResult> {
    const { buffer, headers } = await this.requestRaw(
      "POST",
      "/v1/render?sync=true",
      {
        ...input,
        ...options,
      },
    );

    return {
      pdf: buffer,
      pageCount: parseInt(headers["x-page-count"] ?? "0", 10),
      fileSize: parseInt(headers["x-file-size"] ?? "0", 10),
      renderTimeMs: parseInt(headers["x-render-time-ms"] ?? "0", 10),
      totalTimeMs: parseInt(headers["x-total-time-ms"] ?? "0", 10),
    };
  }

  /** Poll job status */
  async getJob(jobId: string): Promise<RenderJob> {
    return this.request<RenderJob>("GET", `/v1/render/${jobId}`);
  }

  /** Cancel a queued or processing job */
  async cancelJob(jobId: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/render/${jobId}`);
  }

  /** Download the PDF for a completed job */
  async downloadPdf(jobId: string): Promise<Buffer> {
    const { buffer } = await this.requestRaw(
      "GET",
      `/v1/render/${jobId}/download`,
    );
    return buffer;
  }

  /**
   * Download one page of a completed screenshot job.
   *
   * @param page 1-based page number, matching the order of `screenshotUrls`.
   */
  async downloadScreenshot(
    jobId: string,
    page = 1,
  ): Promise<ScreenshotResult> {
    const { buffer, headers } = await this.requestRaw(
      "GET",
      `/v1/render/${jobId}/screenshot/${page}`,
    );
    return {
      image: buffer,
      contentType: headers["content-type"] ?? "application/octet-stream",
    };
  }

  /** Poll until job completes or fails */
  async waitForCompletion(
    jobId: string,
    options?: { timeout?: number; interval?: number },
  ): Promise<RenderJob> {
    const timeout = options?.timeout ?? 60000;
    const interval = options?.interval ?? 1000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const job = await this.getJob(jobId);
      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "canceled"
      ) {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new PDFGlyphError("Timeout waiting for render completion", 408);
  }

  /** Verify a webhook signature */
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(
        Buffer.from(`sha256=${expected}`),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }
}

export class PDFGlyphError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PDFGlyphError";
  }
}
