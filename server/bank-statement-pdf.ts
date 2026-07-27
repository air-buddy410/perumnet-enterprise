import "server-only";

import { PDFParse } from "pdf-parse";
import {
  parseBankStatementPdfText,
  type ParsedBankStatement,
} from "./bank-statement";

const MAX_PDF_PAGES = 50;

export async function parseBankStatementPdf(
  bytes: Uint8Array,
  accountId: string,
  statementMonth?: string,
): Promise<ParsedBankStatement> {
  const parser = new PDFParse({ data: bytes });
  try {
    const information = await parser.getInfo();
    if (information.total > MAX_PDF_PAGES) {
      return {
        entries: [],
        errors: [`PDF mutasi maksimal ${MAX_PDF_PAGES} halaman.`],
      };
    }
    const result = await parser.getText({ first: information.total });
    if (!result.text.trim()) {
      return {
        entries: [],
        errors: [
          "PDF tidak memiliki teks yang dapat dibaca. Gunakan e-statement asli, bukan hasil scan/foto.",
        ],
      };
    }
    return parseBankStatementPdfText(
      result.text,
      accountId,
      statementMonth,
    );
  } catch (error) {
    const passwordProtected =
      error instanceof Error && /password/i.test(error.message);
    return {
      entries: [],
      errors: [
        passwordProtected
          ? "PDF dilindungi kata sandi. Unduh e-statement tanpa password sebelum diimpor."
          : "PDF mutasi tidak dapat dibaca atau formatnya rusak.",
      ],
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
