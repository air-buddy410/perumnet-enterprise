const envFile = process.env.EMAIL_ENV_FILE;
if (envFile) {
  process.loadEnvFile(envFile);
}

const baseUrl =
  process.env.EMAIL_WORKER_APP_URL ??
  process.env.APP_URL ??
  "http://127.0.0.1:3000";
const secret = process.env.EMAIL_WORKER_SECRET;
const intervalMs = Math.max(
  10_000,
  Number(process.env.EMAIL_WORKER_INTERVAL_MS ?? 30_000),
);

if (!secret) {
  throw new Error("EMAIL_WORKER_SECRET wajib diisi.");
}

let stopping = false;

async function dispatch() {
  try {
    const response = await fetch(
      new URL("/api/internal/email-dispatch", baseUrl),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      console.error(
        `[email-worker] dispatch gagal (${response.status}): ${body.slice(0, 500)}`,
      );
    }
  } catch (error) {
    console.error(
      `[email-worker] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

while (!stopping) {
  await dispatch();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
