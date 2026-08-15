// Live smoke test: drives the built Node client against the real API using a
// pk_test_ key. Test keys return static responses matching the production
// schema, so this burns no quota and renders nothing — it verifies that the
// request paths, response shape, and status codes the client depends on are
// still what the server sends.
//
// Coverage note: test keys intercept POST /v1/render, GET /:jobId and
// DELETE /:jobId only. The sync path, download, and screenshot routes are NOT
// reachable this way; those are covered by the contract snapshot test in the
// service repo.
import { PDFGlyph, PDFGlyphError } from "../node/dist/esm/index.js";

const apiKey = process.env.PDFGLYPH_TEST_KEY;
// `||` not `??`: an unset GitHub Actions variable arrives as an empty string,
// which `??` would happily pass through as the base URL.
const baseUrl = process.env.PDFGLYPH_BASE_URL || "https://pdfglyph.com";

if (!apiKey) {
  console.error("PDFGLYPH_TEST_KEY is not set");
  process.exit(1);
}
if (!apiKey.startsWith("pk_test_")) {
  console.error("Refusing to run: key is not a pk_test_ key (would bill real renders)");
  process.exit(1);
}

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const client = new PDFGlyph(apiKey, { baseUrl });

try {
  const job = await client.render({ html: "<h1>smoke</h1>" });
  check("POST /v1/render returns a jobId", typeof job.jobId === "string" && job.jobId.length > 0, job.jobId);
  check("POST /v1/render returns a status", typeof job.status === "string", job.status);

  const fetched = await client.getJob(job.jobId);
  check("GET /v1/render/:jobId returns the job", typeof fetched.status === "string", fetched.status);
  check(
    "job carries the fields the client maps",
    "jobId" in fetched && "status" in fetched,
    Object.keys(fetched).join(","),
  );

  // cancelJob regressed once by calling response.json() on a 204. Any throw
  // here means that class of bug is back.
  let cancelThrew = null;
  try {
    await client.cancelJob(job.jobId);
  } catch (err) {
    cancelThrew = err instanceof PDFGlyphError ? `${err.statusCode}: ${err.message}` : String(err);
  }
  check("DELETE /v1/render/:jobId completes without throwing", cancelThrew === null, cancelThrew ?? "");
} catch (err) {
  check("smoke run completed", false, err instanceof PDFGlyphError ? `${err.statusCode}: ${err.message}` : String(err));
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nnode client: all checks passed");
