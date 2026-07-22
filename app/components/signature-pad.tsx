"use client";

import { Eraser } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState } from "react";

interface SignaturePadProps {
  language?: "id" | "en";
  label: string;
  signer: string;
  value?: string;
  disabled?: boolean;
  onChange: (dataUrl: string) => void;
}

export function SignaturePad({ language = "id", label, signer, value = "", disabled = false, onChange }: SignaturePadProps) {
  const id = language === "id";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const [hasLocalSignature, setHasLocalSignature] = useState(false);
  const hasSignature = Boolean(value) || hasLocalSignature;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!value) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const rect = canvas.getBoundingClientRect();
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, rect.width, rect.height);
    };
    image.src = value;
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const snapshot = hasSignature ? canvas.toDataURL() : "";
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.strokeStyle = "#31505e";
      context.lineWidth = 2.25;
      context.lineCap = "round";
      context.lineJoin = "round";
      if (snapshot) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = snapshot;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasSignature]);

  function pointFromEvent(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = pointFromEvent(event);
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
    setHasLocalSignature(true);
  }

  function finishDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(event.currentTarget.toDataURL("image/png"));
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    setHasLocalSignature(false);
    onChange("");
  }

  return (
    <section className="signature-card">
      <div className="signature-card-head">
        <div>
          <span>{label}</span>
          <strong>{signer || (id ? "Nama penanda tangan" : "Signer's name")}</strong>
        </div>
        {!disabled && (
          <button className="button subtle small" type="button" onClick={clearSignature}>
            <Eraser size={15} /> {id ? "Hapus" : "Clear"}
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-disabled={disabled}
        aria-label={`${id ? "Area tanda tangan" : "Signature area"} ${label}`}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      />
      <div className="signature-line">
        <span>{hasSignature ? (id ? "Tanda tangan tersimpan" : "Signature saved") : (id ? "Goreskan tanda tangan di area ini" : "Sign in this area")}</span>
      </div>
    </section>
  );
}
