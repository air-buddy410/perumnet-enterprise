"use client";

import type { AccessPermissions } from "@/shared/access";
import { appPath } from "./paths";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Project Manager" | "Engineer" | "Finance";
  status: "Aktif" | "Nonaktif";
  permissions: AccessPermissions;
  preferredLanguage: "id" | "en";
  avatarUrl?: string;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(appPath(url), {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("perumnet:session-expired"));
    }
    throw new ApiClientError(
      payload?.error?.message ?? "Permintaan tidak dapat diproses.",
      response.status,
      payload?.error?.code,
      payload?.error?.details,
    );
  }
  return payload?.data as T;
}

export function messageOf(error: unknown, language: "id" | "en" = "id") {
  if (language === "id") {
    return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba kembali.";
  }
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: "Your eight-hour session has expired. Please sign in again.",
      FORBIDDEN: "Your account is not authorized to perform this action.",
      NOT_FOUND: "The requested data was not found or is outside your project access.",
      INVALID_CREDENTIALS: "The email address or password is incorrect.",
      ACCOUNT_INACTIVE: "This account is inactive.",
      PROJECT_REQUIRED: "Select a project first.",
      EMPTY_BOQ: "Add BoQ items first.",
      VALIDATION_ITEMS_REQUIRED: "The BoQ needs at least one Device or Material item.",
      VALIDATION_REQUIRED: "Complete the Device and Material validation before issuing the handover certificate.",
      VALIDATION_INCOMPLETE: "Check every Device and Material before completing validation.",
      SIGNATURES_REQUIRED: "Client and PerumNet signatures are required before finalization.",
      FILE_TOO_LARGE: "The file is too large.",
      UNSUPPORTED_FILE: "This file format is not supported.",
    };
    return error.code && messages[error.code]
      ? messages[error.code]
      : "The request could not be completed. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

export async function downloadApiFile(url: string, fallbackName: string) {
  const response = await fetch(appPath(url), { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("perumnet:session-expired"));
    }
    const payload = await response.json().catch(() => null);
    throw new ApiClientError(
      payload?.error?.message ?? "Dokumen tidak dapat diunduh.",
      response.status,
      payload?.error?.code,
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const matched = disposition.match(/filename="([^"]+)"/);
  const filename = matched?.[1] ?? fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
