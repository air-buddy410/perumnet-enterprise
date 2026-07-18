import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { getCloudflareEnvironment } from "./cloudflare";

function localStoragePath(id: string) {
  const uploadDirectory = process.env.UPLOAD_DIR;
  if (
    !uploadDirectory?.startsWith("/") ||
    !/^[a-zA-Z0-9-]+$/.test(id)
  ) {
    return null;
  }
  return `${uploadDirectory.replace(/\/+$/, "")}/${id}`;
}

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
  const localPath = localStoragePath(id);
  if (localPath) {
    const directory = localPath.slice(0, localPath.lastIndexOf("/"));
    await mkdir(directory, { recursive: true, mode: 0o750 });
    const temporaryPath = `${localPath}.tmp`;
    await writeFile(temporaryPath, Buffer.from(content), { mode: 0o640 });
    await rename(temporaryPath, localPath);
    return { storageUrl: `local://${id}`, contentBase64: null };
  }
  return {
    storageUrl: null,
    contentBase64: Buffer.from(content).toString("base64"),
  };
}

export async function readProjectFile(storageUrl: string | null) {
  if (storageUrl?.startsWith("local://")) {
    const localPath = localStoragePath(storageUrl.slice("local://".length));
    if (!localPath) return null;
    const file = await readFile(localPath);
    return {
      content: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      contentType: undefined,
    };
  }
  if (storageUrl?.startsWith("r2://")) {
    const environment = await getCloudflareEnvironment();
    const object = await environment?.FILES?.get(storageUrl.slice("r2://".length));
    if (!object) return null;
    return {
      content: await object.arrayBuffer(),
      contentType: object.httpMetadata?.contentType,
    };
  }
  return null;
}
