import "server-only";

import { getCloudflareEnvironment } from "./cloudflare";

export async function storeProjectFile(
  id: string,
  mimeType: string,
  content: ArrayBuffer,
) {
  const environment = await getCloudflareEnvironment();
  if (environment?.FILES) {
    const key = `project-documents/${id}`;
    await environment.FILES.put(key, content, {
      httpMetadata: { contentType: mimeType },
    });
    return { storageUrl: `r2://${key}`, contentBase64: null };
  }
  return {
    storageUrl: null,
    contentBase64: Buffer.from(content).toString("base64"),
  };
}

export async function readProjectFile(storageUrl: string | null) {
  if (!storageUrl?.startsWith("r2://")) return null;
  const environment = await getCloudflareEnvironment();
  const object = await environment?.FILES?.get(storageUrl.slice("r2://".length));
  if (!object) return null;
  return {
    content: await object.arrayBuffer(),
    contentType: object.httpMetadata?.contentType,
  };
}
