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

const mailcowPasswordErrorCodes = new Set([
  "INVALID_PASSWORD",
  "MAILCOW_REJECTED",
  "MAILCOW_NOT_CONFIGURED",
  "MAILSERVER_UNREACHABLE",
]);

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
  if (
    error instanceof ApiClientError &&
    error.code &&
    mailcowPasswordErrorCodes.has(error.code)
  ) {
    return error.message;
  }
  if (language === "id") {
    return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba kembali.";
  }
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: "Your eight-hour session has expired. Please sign in again.",
      FORBIDDEN: "Your account is not authorized to perform this action.",
      EXPENSE_REPORT_FORBIDDEN:
        "The project expense report carries the company account that paid and the reimbursement owed to each person, so downloading it needs at least View on Finance. Ask an Admin for that permission if you genuinely need the file.",
      NOT_FOUND: "The requested data was not found or is outside your project access.",
      INVALID_CREDENTIALS: "The email address or password is incorrect.",
      ACCOUNT_INACTIVE: "This account is inactive.",
      AUTH_RATE_LIMITED:
        "Too many attempts. Wait a few minutes before trying again.",
      INVALID_RESET_TOKEN: "This recovery link is invalid or has already expired.",
      INVALID_EMAIL_CHANGE_TOKEN:
        "This email confirmation link is invalid or has already expired.",
      EMAIL_EXISTS: "That email address is already used by another account.",
      INVALID_PASSWORD: "The current password is incorrect.",
      PROJECT_REQUIRED: "Select a project first.",
      EMPTY_BOQ: "Add BoQ items first.",
      VALIDATION_ITEMS_REQUIRED: "The BoQ needs at least one Device or Material item.",
      VALIDATION_REQUIRED: "Complete the Device and Material validation before issuing the handover certificate.",
      VALIDATION_INCOMPLETE: "Check every Device and Material before completing validation.",
      SIGNATURES_REQUIRED: "Client and PerumNet signatures are required before finalization.",
      FILE_TOO_LARGE: "The file is too large.",
      UNSUPPORTED_FILE: "This file format is not supported.",
      INVALID_STATEMENT: "No valid bank transactions were found in this statement.",
      STATEMENT_PERIOD_MISMATCH: "The selected period does not match the period in the PDF.",
      BANK_ACCOUNT_MISMATCH: "The account number in the PDF does not match the selected bank account.",
      GEMINI_NOT_CONFIGURED: "The AI assistant is not configured on this server yet.",
      AI_DAILY_LIMIT: "The limit of 20 AI analyses per user per day has been reached.",
      AI_CONCURRENCY_LIMIT: "At most two AI analyses can run at the same time.",
      AI_RUN_NOT_DRAFT: "Only draft AI recommendations can be processed.",
      AI_RECOMMENDATION_EXPIRED: "The recommendation is older than seven days. Refresh the analysis or provide an override reason.",
      SKU_EXISTS: "This SKU is already used by another item.",
      INVOICE_HISTORY_EXISTS: "An invoice with payment history cannot be deleted. Void the payment instead.",
      INVOICE_TAX_COMMITTED: "An invoice whose tax obligations are already settled or reported cannot be deleted.",
      QUOTATION_IN_USE: "The quotation cannot be deleted or voided because it already has an invoice.",
      QUOTATION_IN_USE_PAYMENT: "The quotation cannot be voided because its invoice has already received a payment. Void that payment first.",
      QUOTATION_IN_USE_PROCUREMENT: "The quotation cannot be deleted because a procurement document (SPK/PO) still references it.",
      INVALID_QUOTATION_STATUS: "That quotation status change does not follow the workflow. A voided, rejected, or superseded quotation cannot be reactivated.",
      ACCEPTED_QUOTATION_LOCKED: "A client-accepted quotation is locked and cannot be changed or deleted.",
      PROJECT_HAS_FINANCIAL_HISTORY:
        "This project already has recorded cash (payments, settlements, or transactions), so it cannot be deleted. Close or archive it instead so the financial record stays intact.",
      INVOICE_LOCKED: "An invoice with payment history cannot be edited. Void the payment first.",
      VALIDATION_ERROR: "The submitted data is not valid. Check the highlighted fields and try again.",
      BRAND_REQUIRED: "Select a brand for Device or Material items.",
      BRAND_CATEGORY_MISMATCH: "The brand does not belong to the selected active category.",
      CATEGORY_NOT_FOUND:
        "That catalog category no longer exists — someone may have just deleted it. Reload the catalog and pick another one.",
      CATEGORY_IN_USE:
        "This category is still used by catalog items, so it cannot be deleted. Deactivate it instead so the history stays intact.",
      BRAND_IN_USE:
        "This brand is still used by catalog items, so it cannot be deleted. Deactivate it instead so the history stays intact.",
      ITEM_IN_USE:
        "This item is already used in a BoQ or a BoQ template, so it cannot be deleted. Deactivate it instead so the history stays intact.",
      EXPENSE_BANK_ACCOUNT_REQUIRED:
        "Select an active company account for a purchase paid by bank transfer.",
      ADVANCE_UNAVAILABLE:
        "This project has no active advance yet. Disburse an advance from the Advance menu first.",
      INVALID_EXPENSE_PAYER:
        "The personal funds owner must be the submitter or an active project member.",
      SELF_APPROVAL_FORBIDDEN:
        "Finance cannot approve a document it created, submitted, or paid for itself. Ask another approver.",
      OVERRIDE_REASON_REQUIRED:
        "An administrator must state a reason when approving their own submission.",
      LEGACY_ENDPOINT_READ_ONLY:
        "Work orders can only be read here. Create, pay, and close them in Procurement so approval, verification, payment evidence, and the audit trail stay complete.",
      PACKAGE_NOT_ACTIVE:
        "This commercial package is no longer active, so it cannot take new documents. Reactivate it or pick another package.",
      INVALID_PACKAGE_STATUS:
        "That package status change does not follow the workflow. A cancelled (Void) package cannot be reactivated.",
      REPORTING_DOWNGRADE_FORBIDDEN:
        "Tax reporting only moves forward. Only an administrator can walk back a status that was already reported, and only with a recorded reason.",
      REPORTING_REASON_REQUIRED:
        "State a reason for lowering the tax reporting status so it lands in the audit trail.",
      REPORT_REFERENCE_REQUIRED:
        "Enter the tax return reference before marking the obligation as reported.",
      SYSTEM_TRANSACTION:
        "This cash entry was posted by a source document. Change it there, not in the ledger.",
      TRANSACTION_RECONCILED:
        "This entry is already matched to a bank statement line. Release the reconciliation first.",
      VALIDATION_STALE:
        "The BoQ of this package changed after the checklist was completed. Re-sync and re-check every Device and Material before issuing the handover certificate.",
      BOQ_BELOW_INVOICED_TOTAL:
        "The BoQ cannot fall below the invoices already issued for this package. Edit or delete those invoices first.",
      PACKAGE_NOT_FOUND: "That commercial package was not found in this project.",
      ROUNDING_ADJUSTMENT_TOO_LARGE:
        "A custom rounding adjustment has to stay a rounding. Use the discount or tax fields for a larger change to the price.",
      PROJECT_VALUE_DERIVED:
        "This project's value follows its client-accepted quotation and cannot be typed in by hand. Issue an addendum if the contract value changed.",
      VALIDATION_LOCKED_BY_BAST:
        "This checklist is the evidence behind an issued handover certificate, so it cannot be edited or reverted to Draft. Void that certificate first.",
      ADVANCE_ALREADY_USED:
        "This advance has already been spent or partly returned, so it cannot be voided. Record an advance return to close the remaining balance.",
      RECONCILIATION_LOCKED:
        "This entry is already matched to a bank statement line. Release the reconciliation first.",
      LEGACY_INVOICE_PAYMENT_RETIRED:
        "The old payment-confirmation endpoint has been retired. Record the payment from the invoice payment history so its reference, method, and proof are complete.",
      TURNSTILE_NOT_CONFIGURED:
        "Form security verification is switched off on this server, so the message could not be sent. Reach us on WhatsApp or by email in the meantime.",
      TURNSTILE_ACTION_MISMATCH:
        "That security check did not come from this form. Reload the page and try again.",
      TURNSTILE_REQUIRED: "Complete the security check first.",
      TURNSTILE_FAILED:
        "The security check failed or has expired. Please try again.",
      TURNSTILE_HOST_MISMATCH:
        "The security check does not match this site.",
      RATE_LIMITED: "Too many requests. Please try again later.",
      METHOD_NOT_ALLOWED: "That action is not supported on this endpoint.",
      EMAIL_BODY_PURGED:
        "This message was cleared after its delivery attempts ran out, so it cannot be resent. Repeat the original action to generate a fresh email.",
      EMAIL_NOT_RETRYABLE:
        "That email was not found, or its status does not allow another attempt.",
      INVALID_COORDINATE:
        "That map point is outside the possible range. Latitude runs from -90 to 90 and longitude from -180 to 180.",
      INCOMPLETE_COORDINATE:
        "A map point needs both a latitude and a longitude. Provide both, or clear both to take the project off the map.",
      IMAGE_TYPE_MISMATCH: "The file type does not match the actual image contents.",
      INVALID_IMAGE: "That file is not a valid image.",
      IMAGE_DIMENSIONS: "The image may be at most 4096 × 4096 pixels.",
      IMAGE_PROCESSING_FAILED: "The image could not be processed.",
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
