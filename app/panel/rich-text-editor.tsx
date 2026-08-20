"use client";

import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
} from "lucide-react";
import {
  forwardRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import styles from "./prospects.module.css";

export type RichTextEditorHandle = {
  focus: () => void;
  insertPlaceholder: (value: string) => void;
};

type RichTextFormat = "text" | "rich" | "html";

type RichTextEditorProps = {
  value: string;
  format: RichTextFormat;
  disabled?: boolean;
  onChange: (value: string, format: RichTextFormat) => void;
};

function scheduleSelection(textarea: HTMLTextAreaElement, start: number, end = start) {
  const restore = () => {
    textarea.focus();
    textarea.setSelectionRange(start, end);
  };

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(restore);
  } else {
    window.setTimeout(restore, 0);
  }
}

function lineRange(value: string, start: number, end: number) {
  const blockStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const selectionEndsAtNewLine = end > start && value[end - 1] === "\n";
  const searchFrom = selectionEndsAtNewLine ? end - 1 : end;
  const nextNewLine = value.indexOf("\n", Math.max(blockStart, searchFrom));
  const blockEnd = nextNewLine === -1 ? value.length : nextNewLine;
  return { blockStart, blockEnd };
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, format, disabled = false, onChange },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorDisabled = disabled || format === "html";

  const replaceSelection = useCallback((replacement: string, selectionStart: number, selectionEnd: number, nextFormat = format) => {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    onChange(nextValue, nextFormat);
    scheduleSelection(textarea, selectionStart, selectionEnd);
  }, [disabled, format, onChange, value]);

  const wrapSelection = useCallback((opening: string, closing: string) => {
    if (editorDisabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const nextSelectionStart = start + opening.length;
    const nextSelectionEnd = selected ? nextSelectionStart + selected.length : nextSelectionStart;
    replaceSelection(`${opening}${selected}${closing}`, nextSelectionStart, nextSelectionEnd, "rich");
  }, [editorDisabled, replaceSelection, value]);

  const applyList = useCallback((ordered: boolean) => {
    if (editorDisabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const { blockStart, blockEnd } = lineRange(value, start, end);
    const selectedBlock = value.slice(blockStart, blockEnd);
    const lines = selectedBlock.split("\n");
    let itemNumber = 1;
    const nextBlock = lines.map((line) => {
      if (!line.trim()) return line;
      const prefix = ordered ? `${itemNumber++}. ` : "- ";
      return `${prefix}${line}`;
    }).join("\n");
    const normalizedBlock = nextBlock || (ordered ? "1. " : "- ");
    const nextValue = `${value.slice(0, blockStart)}${normalizedBlock}${value.slice(blockEnd)}`;
    onChange(nextValue, "rich");
    scheduleSelection(textarea, blockStart, blockStart + normalizedBlock.length);
  }, [editorDisabled, onChange, value]);

  const insertLink = useCallback(() => {
    if (editorDisabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "teks tautan";
    const url = "https://";
    const replacement = `[${selected}](${url})`;
    const urlStart = start + selected.length + 3;
    replaceSelection(replacement, urlStart, urlStart + url.length, "rich");
  }, [editorDisabled, replaceSelection, value]);

  const insertText = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
    onChange(nextValue, format);
    scheduleSelection(textarea, start + text.length);
  }, [disabled, format, onChange, value]);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    insertPlaceholder: insertText,
  }), [insertText]);

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const plainText = event.clipboardData.getData("text/plain");
    if (plainText) insertText(plainText);
  }

  function handleToolbarMouseDown(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (editorDisabled || !(event.metaKey || event.ctrlKey)) return;
    const shortcut = event.key.toLowerCase();
    if (shortcut === "b") {
      event.preventDefault();
      wrapSelection("**", "**");
    } else if (shortcut === "i") {
      event.preventDefault();
      wrapSelection("*", "*");
    }
  }

  return <div className={styles.richTextEditor}>
    <div className={styles.richTextToolbar} role="toolbar" aria-label="Format isi surat" aria-disabled={editorDisabled}>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => wrapSelection("**", "**")} disabled={editorDisabled} aria-label="Tebal" title="Tebal"><Bold size={16} strokeWidth={2.5} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => wrapSelection("*", "*")} disabled={editorDisabled} aria-label="Miring" title="Miring"><Italic size={16} /></button>
      <span className={styles.richTextDivider} aria-hidden="true" />
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => applyList(false)} disabled={editorDisabled} aria-label="Daftar berpoin" title="Daftar berpoin"><List size={17} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={() => applyList(true)} disabled={editorDisabled} aria-label="Daftar bernomor" title="Daftar bernomor"><ListOrdered size={17} /></button>
      <button type="button" className={styles.richTextButton} onMouseDown={handleToolbarMouseDown} onClick={insertLink} disabled={editorDisabled} aria-label="Sisipkan tautan" title="Sisipkan tautan (http/https/mailto)"><Link2 size={16} /></button>
    </div>
    <textarea
      ref={textareaRef}
      className={styles.richTextSurface}
      value={value}
      disabled={disabled}
      required
      rows={13}
      aria-label="Isi surat"
      aria-describedby="rich-text-editor-help"
      placeholder="Tulis isi surat di sini..."
      onChange={(event) => onChange(event.target.value, format)}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
    />
    {format === "html" ? <small id="rich-text-editor-help" className={styles.richTextModeWarning}>Template ini menggunakan HTML tulisan tangan. Toolbar rich-text dinonaktifkan agar markup lama tetap utuh.</small> : <small id="rich-text-editor-help" className={styles.richTextHelp}>Mode {format === "rich" ? "rich-text" : "teks biasa"}. Toolbar menyimpan marker: <code>**tebal**</code>, <code>*miring*</code>, <code>- daftar</code>, <code>1. daftar</code>, dan <code>[teks](https://...)</code>. Paste selalu diambil sebagai teks biasa.</small>}
  </div>;
});

RichTextEditor.displayName = "RichTextEditor";
