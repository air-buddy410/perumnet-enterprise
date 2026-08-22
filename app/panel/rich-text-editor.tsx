"use client";

import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import styles from "./prospects.module.css";

export type RichTextEditorHandle = {
  focus: () => void;
  insertPlaceholder: (value: string) => void;
};

type RichTextFormat = "text" | "rich" | "html";
type RichTextLanguage = "id" | "en";

type RichTextEditorProps = {
  value: string;
  format: RichTextFormat;
  disabled?: boolean;
  language?: RichTextLanguage;
  onChange: (value: string, format: RichTextFormat) => void;
};

const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "blockquote", "ul", "ol", "li"]);
const INLINE_TAGS = new Set(["strong", "b", "em", "i", "u", "s", "del", "span", "a", "br"]);
const DROP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "img", "video", "audio", "form", "input", "textarea", "button", "select"]);
const FONT_FAMILIES = ["Arial", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Courier New", "Times New Roman"];
const HTML_FONT_SIZES: Record<string, string> = {
  "1": "10px",
  "2": "12px",
  "3": "14px",
  "4": "16px",
  "5": "18px",
  "6": "24px",
  "7": "32px",
};
const CSS_FONT_SIZE_ALIASES: Record<string, string> = {
  "xx-small": "10px",
  "x-small": "12px",
  small: "12px",
  medium: "14px",
  large: "18px",
  "x-large": "24px",
  "xx-large": "32px",
};
const PARAGRAPH_INDENT = "\u00a0\u00a0\u00a0\u00a0";

const copy = {
  id: {
    toolbar: "Format isi surat",
    paragraph: "Paragraf",
    heading1: "Judul 1",
    heading2: "Judul 2",
    heading3: "Judul 3",
    font: "Font",
    size: "Ukuran font",
    bold: "Tebal",
    italic: "Miring",
    underline: "Garis bawah",
    strike: "Coret",
    textColor: "Warna teks",
    left: "Rata kiri",
    center: "Rata tengah",
    right: "Rata kanan",
    justify: "Rata kiri-kanan",
    bullets: "Daftar berpoin",
    numbers: "Daftar bernomor",
    quote: "Kutipan",
    rule: "Garis pemisah",
    link: "Sisipkan tautan",
    undo: "Urungkan",
    redo: "Ulangi",
    clear: "Hapus format",
    placeholder: "Tulis isi surat di sini…",
    help: "Editor visual menyimpan HTML aman. Toolbar mendukung paragraf, judul, ukuran dan keluarga font, alignment, daftar, kutipan, tautan, warna, serta undo/redo.",
    tabIndent: "Tab menambah indentasi paragraf; Shift+Tab menguranginya.",
    linkPrompt: "Masukkan URL tautan (http, https, atau mailto)",
    linkSelection: "Pilih teks terlebih dahulu untuk dijadikan tautan.",
    invalidLink: "Gunakan tautan http, https, atau mailto.",
  },
  en: {
    toolbar: "Letter body formatting",
    paragraph: "Paragraph",
    heading1: "Heading 1",
    heading2: "Heading 2",
    heading3: "Heading 3",
    font: "Font",
    size: "Font size",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    strike: "Strikethrough",
    textColor: "Text color",
    left: "Align left",
    center: "Align center",
    right: "Align right",
    justify: "Justify",
    bullets: "Bulleted list",
    numbers: "Numbered list",
    quote: "Quote",
    rule: "Horizontal rule",
    link: "Insert link",
    undo: "Undo",
    redo: "Redo",
    clear: "Clear formatting",
    placeholder: "Write the letter here…",
    help: "The visual editor stores safe HTML. The toolbar supports paragraphs, headings, font family and size, alignment, lists, quotes, links, color, and undo/redo.",
    tabIndent: "Tab indents the paragraph; Shift+Tab reduces the indent.",
    linkPrompt: "Enter a link URL (http, https, or mailto)",
    linkSelection: "Select text first to turn it into a link.",
    invalidLink: "Use an http, https, or mailto link.",
  },
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value: string) {
  const url = value.trim();
  return /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(url) ? url : null;
}

function safeColor(value: string) {
  const color = value.trim();
  return /^(#[0-9a-f]{3,8}|rgba?\(\s*[0-9 .%,]+\s*\))$/i.test(color) ? color : null;
}

function safeFontFamily(value: string) {
  const firstFamily = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  return FONT_FAMILIES.find((family) => family.toLowerCase() === firstFamily.toLowerCase()) ?? null;
}

function safeFontSize(value: string) {
  const size = value.trim().toLowerCase();
  if (/^(10|12|14|16|18|20|24|28|32)px$/.test(size)) return size;
  if (CSS_FONT_SIZE_ALIASES[size]) return CSS_FONT_SIZE_ALIASES[size];
  const points = size.match(/^(10|12|14|16|18|20|24)pt$/)?.[1];
  return points ? `${Math.round(Number(points) * 1.333)}px` : null;
}

function safeStyle(element: HTMLElement, legacyStyles: Record<string, string> = {}) {
  const result: string[] = [];
  const push = (property: string, value: string | null) => {
    if (value && !result.some((item) => item.startsWith(`${property}:`))) result.push(`${property}:${value}`);
  };

  const fontSize = element.style.getPropertyValue("font-size").trim();
  push("font-size", safeFontSize(fontSize));
  const fontFamily = safeFontFamily(element.style.getPropertyValue("font-family"));
  if (fontFamily) push("font-family", `${fontFamily},Arial,sans-serif`);
  const textAlign = element.style.getPropertyValue("text-align").trim().toLowerCase();
  if (/^(left|center|right|justify)$/.test(textAlign)) push("text-align", textAlign);
  const color = safeColor(element.style.getPropertyValue("color"));
  if (color) push("color", color);
  const backgroundColor = safeColor(element.style.getPropertyValue("background-color"));
  if (backgroundColor) push("background-color", backgroundColor);
  const fontWeight = element.style.getPropertyValue("font-weight").trim().toLowerCase();
  if (/^(normal|bold|[4-9]00)$/.test(fontWeight)) push("font-weight", fontWeight);
  const fontStyle = element.style.getPropertyValue("font-style").trim().toLowerCase();
  if (/^(normal|italic|oblique)$/.test(fontStyle)) push("font-style", fontStyle);
  const textDecoration = element.style.getPropertyValue("text-decoration").trim().toLowerCase();
  if (/^(none|underline|line-through)$/.test(textDecoration)) push("text-decoration", textDecoration);
  const lineHeight = element.style.getPropertyValue("line-height").trim().toLowerCase();
  if (/^(normal|1(?:\.\d+)?|[2-9])$/.test(lineHeight)) push("line-height", lineHeight);

  for (const [property, value] of Object.entries(legacyStyles)) {
    if (property === "font-size") push(property, safeFontSize(value));
    if (property === "font-family" && safeFontFamily(value)) push(property, `${safeFontFamily(value)},Arial,sans-serif`);
    if (property === "text-align" && /^(left|center|right|justify)$/.test(value)) push(property, value);
    if ((property === "color" || property === "background-color") && safeColor(value)) push(property, value);
  }
  return result.join(";");
}

function sanitizeNode(node: Node, documentRef: Document): Node | null {
  if (node.nodeType === 3) return documentRef.createTextNode(node.textContent ?? "");
  if (node.nodeType !== 1) return null;

  const source = node as HTMLElement;
  const tag = source.tagName.toLowerCase();
  if (DROP_TAGS.has(tag)) return null;

  if (tag === "font") {
    const span = documentRef.createElement("span");
    const legacyStyles: Record<string, string> = {};
    const size = source.getAttribute("size");
    const face = source.getAttribute("face");
    const color = source.getAttribute("color");
    if (size && HTML_FONT_SIZES[size]) legacyStyles["font-size"] = HTML_FONT_SIZES[size];
    if (face) legacyStyles["font-family"] = face;
    if (color) legacyStyles.color = color;
    const style = safeStyle(source, legacyStyles);
    if (style) span.setAttribute("style", style);
    for (const child of Array.from(source.childNodes)) {
      const sanitized = sanitizeNode(child, documentRef);
      if (sanitized) span.appendChild(sanitized);
    }
    return span;
  }

  if (!BLOCK_TAGS.has(tag) && !INLINE_TAGS.has(tag) && tag !== "hr") {
    const fragment = documentRef.createDocumentFragment();
    for (const child of Array.from(source.childNodes)) {
      const sanitized = sanitizeNode(child, documentRef);
      if (sanitized) fragment.appendChild(sanitized);
    }
    return fragment;
  }

  const target = documentRef.createElement(tag);
  if (tag !== "br" && tag !== "hr") {
    const style = safeStyle(source);
    if (style) target.setAttribute("style", style);
  }
  if (tag === "a") {
    const href = safeUrl(source.getAttribute("href") ?? "");
    if (!href) {
      const fragment = documentRef.createDocumentFragment();
      for (const child of Array.from(source.childNodes)) {
        const sanitized = sanitizeNode(child, documentRef);
        if (sanitized) fragment.appendChild(sanitized);
      }
      return fragment;
    }
    target.setAttribute("href", href);
  }

  if (tag !== "br" && tag !== "hr") {
    for (const child of Array.from(source.childNodes)) {
      const sanitized = sanitizeNode(child, documentRef);
      if (sanitized) target.appendChild(sanitized);
    }
  }
  return target;
}

function sanitizeHtml(value: string) {
  if (typeof window === "undefined") return value;
  const parsed = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  if (!root) return "";
  const holder = parsed.createElement("div");
  for (const child of Array.from(root.childNodes)) {
    const sanitized = sanitizeNode(child, parsed);
    if (sanitized) holder.appendChild(sanitized);
  }
  return holder.innerHTML;
}

function inlineLegacyToHtml(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (whole, label: string, url: string) => {
      const safe = safeUrl(url);
      return safe ? `<a href="${escapeHtml(safe)}">${label}</a>` : whole;
    })
    .replace(/\*\*([^*]{1,500})\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]{1,500})\*(?!\*)/g, "$1<em>$2</em>");
}

function legacyToHtml(value: string, format: Exclude<RichTextFormat, "html">) {
  if (!value.trim()) return "";
  const blocks = value.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (format === "rich" && lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inlineLegacyToHtml(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    if (format === "rich" && lines.length && lines.every((line) => /^\d+[.)]\s+/.test(line))) {
      return `<ol>${lines.map((line) => `<li>${inlineLegacyToHtml(line.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    }
    return `<p>${inlineLegacyToHtml(block).replaceAll("\n", "<br />")}</p>`;
  }).join("");
}

type SelectionBookmark = {
  start: number;
  end: number;
};

function textOffset(root: HTMLElement, container: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

function textPosition(root: HTMLElement, target: number) {
  const walker = document.createTreeWalker(root, 4);
  let remaining = Math.max(0, target);
  let current = walker.nextNode();
  while (current) {
    const length = current.textContent?.length ?? 0;
    if (remaining <= length) return { node: current, offset: remaining };
    remaining -= length;
    current = walker.nextNode();
  }
  return { node: root, offset: root.childNodes.length };
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, format, disabled = false, language = "id", onChange },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<SelectionBookmark | null>(null);
  const lastEmittedRef = useRef({ value: "", format: "" as RichTextFormat | "" });
  const labels = copy[language];

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedSelectionRef.current = {
        start: textOffset(editor, range.startContainer, range.startOffset),
        end: textOffset(editor, range.endContainer, range.endOffset),
      };
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    const bookmark = savedSelectionRef.current;
    if (!editor || !bookmark) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const start = textPosition(editor, bookmark.start);
    const end = textPosition(editor, bookmark.end);
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (lastEmittedRef.current.value === value && lastEmittedRef.current.format === format) return;
    const html = format === "html" ? sanitizeHtml(value) : legacyToHtml(value, format);
    if (editor.innerHTML !== html) editor.innerHTML = html;
    lastEmittedRef.current = { value, format };
  }, [format, value]);

  useEffect(() => {
    const rememberSelection = () => saveSelection();
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, [saveSelection]);

  const emitHtml = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    saveSelection();
    const html = sanitizeHtml(editor.innerHTML);
    if (editor.innerHTML !== html) {
      editor.innerHTML = html;
      restoreSelection();
    }
    lastEmittedRef.current = { value: html, format: "html" };
    onChange(html, "html");
  }, [disabled, onChange, restoreSelection, saveSelection]);

  const runCommand = useCallback((command: string, commandValue?: string) => {
    if (disabled || !editorRef.current) return;
    restoreSelection();
    editorRef.current.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, commandValue);
    emitHtml();
  }, [disabled, emitHtml, restoreSelection]);

  const insertText = useCallback((text: string) => {
    if (disabled || !editorRef.current) return;
    restoreSelection();
    editorRef.current.focus();
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      const selection = window.getSelection();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    emitHtml();
  }, [disabled, emitHtml, restoreSelection]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertPlaceholder: insertText,
  }), [insertText]);

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const plainText = event.clipboardData.getData("text/plain");
    if (plainText) insertText(plainText);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (event.shiftKey) runCommand("outdent");
      else insertText(PARAGRAPH_INDENT);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const shortcut = event.key.toLowerCase();
    const command = shortcut === "b" ? "bold" : shortcut === "i" ? "italic" : shortcut === "u" ? "underline" : "";
    if (!command) return;
    event.preventDefault();
    runCommand(command);
  }

  function handleToolbarMouseDown(event: MouseEvent<HTMLElement>) {
    saveSelection();
    if (event.currentTarget.tagName === "BUTTON") event.preventDefault();
  }

  function applySelectCommand(event: ChangeEvent<HTMLSelectElement>) {
    const command = event.currentTarget.value;
    event.currentTarget.value = "";
    if (!command) return;
    if (command.startsWith("block:")) runCommand("formatBlock", command.slice("block:".length));
    if (command.startsWith("font:")) runCommand("fontName", command.slice("font:".length));
    if (command.startsWith("size:")) {
      const htmlSize = Object.entries(HTML_FONT_SIZES).find(([, px]) => px === command.slice("size:".length))?.[0] ?? "3";
      runCommand("fontSize", htmlSize);
    }
  }

  function insertLink() {
    if (disabled) return;
    const selection = window.getSelection();
    if (!selection?.toString().trim()) {
      window.alert(labels.linkSelection);
      return;
    }
    const input = window.prompt(labels.linkPrompt, "https://");
    if (!input) return;
    if (!safeUrl(input)) {
      window.alert(labels.invalidLink);
      return;
    }
    runCommand("createLink", input.trim());
  }

  return <div className={styles.richTextEditor}>
    <div className={styles.richTextToolbar} role="toolbar" aria-label={labels.toolbar} aria-disabled={disabled}>
      <select className={styles.richTextSelect} defaultValue="" onMouseDown={handleToolbarMouseDown} onChange={applySelectCommand} disabled={disabled} aria-label={labels.paragraph} title={labels.paragraph}>
        <option value="" disabled>{labels.paragraph}</option>
        <option value="block:p">{labels.paragraph}</option>
        <option value="block:h1">{labels.heading1}</option>
        <option value="block:h2">{labels.heading2}</option>
        <option value="block:h3">{labels.heading3}</option>
        <option value="block:blockquote">{labels.quote}</option>
      </select>
      <select className={styles.richTextSelect} defaultValue="" onMouseDown={handleToolbarMouseDown} onChange={applySelectCommand} disabled={disabled} aria-label={labels.font} title={labels.font}>
        <option value="" disabled>{labels.font}</option>
        {FONT_FAMILIES.map((family) => <option value={`font:${family}`} key={family}>{family}</option>)}
      </select>
      <select className={styles.richTextSelect} defaultValue="" onMouseDown={handleToolbarMouseDown} onChange={applySelectCommand} disabled={disabled} aria-label={labels.size} title={labels.size}>
        <option value="" disabled>{labels.size}</option>
        {["12px", "14px", "16px", "18px", "24px", "32px"].map((size) => <option value={`size:${size}`} key={size}>{size.replace("px", " px")}</option>)}
      </select>
      <span className={styles.richTextDivider} aria-hidden="true" />
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("bold")} disabled={disabled} aria-label={labels.bold} title={labels.bold}><Bold size={16} strokeWidth={2.5} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("italic")} disabled={disabled} aria-label={labels.italic} title={labels.italic}><Italic size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("underline")} disabled={disabled} aria-label={labels.underline} title={labels.underline}><Underline size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("strikeThrough")} disabled={disabled} aria-label={labels.strike} title={labels.strike}><Strikethrough size={16} /></button>
      <label className={styles.richTextColor} title={labels.textColor} aria-label={labels.textColor}>
        <input type="color" defaultValue="#203f4d" onMouseDown={handleToolbarMouseDown} onChange={(event) => runCommand("foreColor", event.currentTarget.value)} disabled={disabled} />
        <span aria-hidden="true">A</span>
      </label>
      <span className={styles.richTextDivider} aria-hidden="true" />
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyLeft")} disabled={disabled} aria-label={labels.left} title={labels.left}><AlignLeft size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyCenter")} disabled={disabled} aria-label={labels.center} title={labels.center}><AlignCenter size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyRight")} disabled={disabled} aria-label={labels.right} title={labels.right}><AlignRight size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyFull")} disabled={disabled} aria-label={labels.justify} title={labels.justify}><AlignJustify size={16} /></button>
      <span className={styles.richTextDivider} aria-hidden="true" />
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("insertUnorderedList")} disabled={disabled} aria-label={labels.bullets} title={labels.bullets}><List size={17} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("insertOrderedList")} disabled={disabled} aria-label={labels.numbers} title={labels.numbers}><ListOrdered size={17} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("formatBlock", "blockquote")} disabled={disabled} aria-label={labels.quote} title={labels.quote}><Quote size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("insertHorizontalRule")} disabled={disabled} aria-label={labels.rule} title={labels.rule}><Minus size={17} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={insertLink} disabled={disabled} aria-label={labels.link} title={labels.link}><Link2 size={16} /></button>
      <span className={styles.richTextDivider} aria-hidden="true" />
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("undo")} disabled={disabled} aria-label={labels.undo} title={labels.undo}><Undo2 size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("redo")} disabled={disabled} aria-label={labels.redo} title={labels.redo}><Redo2 size={16} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("removeFormat")} disabled={disabled} aria-label={labels.clear} title={labels.clear}><Eraser size={16} /></button>
    </div>
    <div
      ref={editorRef}
      className={styles.richTextSurface}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={labels.toolbar}
      data-placeholder={labels.placeholder}
      onInput={emitHtml}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onBlur={saveSelection}
    />
    <small className={styles.richTextHelp}>{labels.help} {labels.tabIndent} {format !== "html" ? (language === "id" ? "Template lama akan beralih ke editor visual saat mulai diedit." : "Legacy templates switch to the visual editor when you start editing.") : ""}</small>
  </div>;
});

RichTextEditor.displayName = "RichTextEditor";
