import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PDFDocument, rgb } from "pdf-lib";
import { Loader2, Upload, Download, Trash2, Minus, Plus, X, PenLine, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { consumeQuota, saveDocument } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { SignaturePad } from "@/components/SignaturePad";
import { CropPreview } from "@/components/CropPreview";

type Phase = "idle" | "preparing" | "ready" | "exporting";
type TextItem = {
  id: string;
  xPercent: number;
  yPercent: number;
  text: string;
  fontSize: number;
  color: string;
};
type SigItem = {
  id: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  dataUrl: string;
};

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const MAX_W = 1400;
const FONT_FAMILY = "Manrope, Arial, sans-serif";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderToImage(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
  const lower = file.name.toLowerCase();
  let working: Blob = file;
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    const heic2any = (await import("heic2any")).default;
    working = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 })) as Blob;
  }
  if (lower.endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_W / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), w: canvas.width, h: canvas.height };
  }
  const url = URL.createObjectURL(working);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sanitize = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";

const uid = () => Math.random().toString(36).slice(2, 10);

export function PdfEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [bg, setBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);

  const [items, setItems] = useState<TextItem[]>([]);
  const [sigs, setSigs] = useState<SigItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultFontSize, setDefaultFontSize] = useState(20);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [sigSheet, setSigSheet] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const cropTimerRef = useRef<number | null>(null);

  const consume = useServerFn(consumeQuota);
  const save = useServerFn(saveDocument);


  // Responsive base scale
  useEffect(() => {
    if (!bg) return;
    const update = () => {
      const w = wrapperRef.current?.clientWidth ?? bg.w;
      const reserved = 220;
      const maxH = Math.max(360, window.innerHeight - reserved);
      setBaseScale(Math.min(1, w / bg.w, maxH / bg.h));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [bg]);

  // Visual viewport / keyboard detection
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboardOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Focus inline edit input WITHOUT scrolling (with small delay for mobile)
  useEffect(() => {
    if (editingId && editInputRef.current) {
      const el = editInputRef.current;
      const t = window.setTimeout(() => {
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
        el.select();
      }, 80);
      return () => window.clearTimeout(t);
    }
  }, [editingId]);

  const handleFile = useCallback(async (file: File) => {
    setOriginalFile(file); setBg(null); setItems([]); setSigs([]); setZoom(1);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      toast.info("Word: σύντομα διαθέσιμο. Δοκίμασε PDF ή φωτογραφία προς το παρόν.");
      setOriginalFile(null); return;
    }
    setPhase("preparing");
    try {
      const out = await renderToImage(file);
      setBg(out);
      setPhase("ready");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Σφάλμα κατά τη φόρτωση.");
      setPhase("idle"); setOriginalFile(null);
    }
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) void handleFile(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f);
  };

  // ---- Pinch & Ctrl+wheel zoom ----
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchRef.current = { startDist: dist, startZoom: zoom };
      tapStartRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / pinchRef.current.startDist;
      const next = Math.max(0.5, Math.min(3, pinchRef.current.startZoom * ratio));
      setZoom(next);
    }
  };

  const overlayRef = useRef<HTMLDivElement>(null);

  const handleTap = async (clientX: number, clientY: number, target: EventTarget | null) => {
    if (!bg || !overlayRef.current) return;
    if (pointersRef.current.size > 0) return;
    // If currently editing, commit the active input first then continue
    if (editingId) {
      const active = (typeof document !== "undefined" ? document.activeElement : null) as HTMLInputElement | null;
      if (active && typeof active.blur === "function") active.blur();
      await new Promise((r) => setTimeout(r, 60));
    }
    const hit = typeof document !== "undefined" ? document.elementFromPoint(clientX, clientY) as HTMLElement | null : (target as HTMLElement | null);
    if (hit?.closest("[data-text-item]") || hit?.closest("[data-sig-item]")) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const dW = bg.w * baseScale * zoom;
    const dH = bg.h * baseScale * zoom;
    const x = (clientX - rect.left) / dW;
    const y = (clientY - rect.top) / dH;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    const id = uid();
    setItems((prev) => [...prev, {
      id, xPercent: x, yPercent: y,
      text: "", fontSize: defaultFontSize, color: "#000000",
    }]);
    setSelectedId(id);
    setEditingId(id);
  };

  const resetAll = () => {
    setBg(null); setOriginalFile(null);
    setItems([]); setSigs([]);
    setSelectedId(null); setEditingId(null);
    setZoom(1); setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasMulti = pointersRef.current.size >= 2;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (wasMulti) { tapStartRef.current = null; return; }
    if (e.pointerType === "touch") return; // handled by onTouchEnd
    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return;
    if (Date.now() - start.t > 600) return;
    handleTap(e.clientX, e.clientY, e.target);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) return;
    if (pointersRef.current.size > 0) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start) return;
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return;
    if (Date.now() - start.t > 600) return;
    e.preventDefault();
    handleTap(t.clientX, t.clientY, e.target);
  };

  // Ctrl+wheel zoom (desktop)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      setZoom((z) => Math.max(0.5, Math.min(3, z * (ev.deltaY < 0 ? 1.1 : 0.9))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bg]);

  const commitEdit = (id: string, text: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text } : it)).filter((it) => it.id !== id || it.text.trim().length > 0));
    setEditingId(null);
  };
  const beginEdit = (id: string) => { setSelectedId(id); setEditingId(id); };
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  };
  const removeSig = (id: string) => {
    setSigs((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const adjustSize = (delta: number) => {
    if (!selectedId) { setDefaultFontSize((s) => Math.max(8, Math.min(80, s + delta))); return; }
    setItems((prev) => prev.map((it) => it.id === selectedId ? { ...it, fontSize: Math.max(8, Math.min(80, it.fontSize + delta)) } : it));
  };

  const addSignature = (dataUrl: string) => {
    setSigSheet(false);
    const id = uid();
    setSigs((prev) => [...prev, { id, xPercent: 0.1, yPercent: 0.7, widthPercent: 0.3, dataUrl }]);
    setSelectedId(id);
  };

  // ---- Crop-before-export flow ----
  const startExportFlow = () => {
    if (!bg || phase === "exporting") return;
    setCropOpen(true);
    if (cropTimerRef.current) window.clearTimeout(cropTimerRef.current);
    cropTimerRef.current = window.setTimeout(() => {
      setCropOpen(false);
      void doExport(bg);
    }, 3000);
  };
  const cancelCropTimer = () => {
    if (cropTimerRef.current) { window.clearTimeout(cropTimerRef.current); cropTimerRef.current = null; }
  };
  const onCropConfirm = (out: { dataUrl: string; w: number; h: number }) => {
    cancelCropTimer();
    setBg(out);
    setCropOpen(false);
    void doExport(out);
  };
  const onCropSkip = () => {
    cancelCropTimer();
    setCropOpen(false);
    if (bg) void doExport(bg);
  };

  const doExport = async (bgArg: { dataUrl: string; w: number; h: number }) => {
    if (!originalFile) return;
    setPhase("exporting");
    let step = "init";
    try {
      step = "Έλεγχος ορίου";
      const { data: authState } = await supabase.auth.getUser();
      const currentUser = authState.user;
      if (currentUser) {
        try {
          unwrapServerFn<{ source: "premium" | "credit" | "free" }>(await consume());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("όριο") || msg.includes("QUOTA_EXCEEDED")) {
            setUpgradeOpen(true); setPhase("ready"); return;
          }
          throw e;
        }
      }

      step = "Σύνθεση εικόνας";
      const baseImg = await loadImage(bgArg.dataUrl);
      const out = document.createElement("canvas");
      out.width = bgArg.w; out.height = bgArg.h;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("Αδυναμία επεξεργασίας εικόνας.");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, bgArg.w, bgArg.h);
      octx.drawImage(baseImg, 0, 0, bgArg.w, bgArg.h);

      octx.textBaseline = "top";
      for (const it of items) {
        const text = it.text.trim();
        if (!text) continue;
        octx.font = `${it.fontSize}px ${FONT_FAMILY}`;
        octx.fillStyle = it.color;
        octx.fillText(text, it.xPercent * bgArg.w, it.yPercent * bgArg.h);
      }
      for (const s of sigs) {
        try {
          const sigImg = await loadImage(s.dataUrl);
          const w = s.widthPercent * bgArg.w;
          const h = (sigImg.naturalHeight / sigImg.naturalWidth) * w;
          octx.drawImage(sigImg, s.xPercent * bgArg.w, s.yPercent * bgArg.h, w, h);
        } catch {}
      }

      step = "Δημιουργία PDF";
      const finalDataUrl = out.toDataURL("image/jpeg", 0.95);
      const finalBytes = await (await fetch(finalDataUrl)).arrayBuffer();
      const A4 = { w: 595, h: 842 };
      const landscape = bgArg.w > bgArg.h;
      const pageW = landscape ? A4.h : A4.w;
      const pageH = landscape ? A4.w : A4.h;
      const margin = 18;
      const fit = Math.min((pageW - margin * 2) / bgArg.w, (pageH - margin * 2) / bgArg.h);
      const drawW = bgArg.w * fit;
      const drawH = bgArg.h * fit;
      const px = (pageW - drawW) / 2;
      const py = (pageH - drawH) / 2;
      const pdfDoc = await PDFDocument.create();
      const jpg = await pdfDoc.embedJpg(finalBytes);
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });
      page.drawImage(jpg, { x: px, y: py, width: drawW, height: drawH });
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

      step = "Ανέβασμα";
      try {
        if (currentUser) {
          const ts = Date.now();
          const safeFull = sanitize(originalFile.name);
          const baseName = sanitize(originalFile.name.replace(/\.[^.]+$/, ""));
          const folder = `${currentUser.id}/${ts}_${baseName}`;
          const originalPath = `${folder}/original_${safeFull}`;
          const filledPath = `${folder}/filled.pdf`;
          const normalizedPath = `${folder}/normalized.pdf`;
          const normDoc = await PDFDocument.create();
          const normBytes = await (await fetch(bgArg.dataUrl)).arrayBuffer();
          const normJpg = await normDoc.embedJpg(normBytes);
          const np = normDoc.addPage([bgArg.w, bgArg.h]);
          np.drawImage(normJpg, { x: 0, y: 0, width: bgArg.w, height: bgArg.h });
          const normalizedBlob = new Blob([new Uint8Array(await normDoc.save())], { type: "application/pdf" });
          await Promise.all([
            supabase.storage.from("originals").upload(originalPath, originalFile, { upsert: true }),
            supabase.storage.from("normalized").upload(normalizedPath, normalizedBlob, { upsert: true }),
            supabase.storage.from("filled").upload(filledPath, pdfBlob, { upsert: true }),
          ]);
          unwrapServerFn(await save({
            data: {
              name: baseName, originalFilePath: originalPath,
              normalizedPdfPath: normalizedPath, filledFilePath: filledPath,
              fields: [...items, ...sigs] as unknown[],
            },
          }));
        }
      } catch (e) { console.warn("[exportPdf] upload/save failed (non-blocking):", e); }

      step = "Λήψη";
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${originalFile.name.replace(/\.[^.]+$/, "")}-συμπληρωμένο.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Έτοιμο! Το αρχείο κατέβηκε.");
    } catch (e) {
      console.error(`[exportPdf] FAILED at step: ${step}`, e);
      const reason = e instanceof Error ? e.message : typeof e === "string" ? e : "άγνωστο σφάλμα";
      toast.error(`Σφάλμα στο βήμα “${step}”: ${reason}`);
    } finally { setPhase("ready"); }
  };

  // ============= RENDER =============
  if (!bg) {
    return (
      <div
        onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
        className="border-2 border-dashed rounded-2xl p-12 sm:p-20 text-center bg-card hover:border-primary transition cursor-pointer min-h-[60vh] flex items-center justify-center"
        onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
      >
        <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden" onChange={onPickFile} />
        {phase === "preparing" ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="font-medium">Επεξεργασία αρχείου…</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-7 w-7" />
            </div>
            <div className="font-semibold text-lg">Σύρετε ή επιλέξτε αρχείο</div>
            <div className="text-sm text-muted-foreground max-w-md">
              PDF, εικόνα ή φωτογραφία από κινητό. Πάτα οπουδήποτε στο έγγραφο για να γράψεις.
            </div>
          </div>
        )}
      </div>
    );
  }

  const effectiveScale = baseScale * zoom;
  const displayW = bg.w * effectiveScale;
  const displayH = bg.h * effectiveScale;

  return (
    <>
      <div ref={wrapperRef} className="relative mx-auto min-h-[60vh]" style={{ width: "100%", paddingBottom: 96, touchAction: "pan-x pan-y" }}>
        <div
          className="relative mx-auto rounded-xl border bg-white shadow-sm overflow-hidden select-none"
          style={{ width: displayW, height: displayH, maxWidth: "100%" }}
        >
          <img src={bg.dataUrl} alt="Έγγραφο" draggable={false} className="absolute inset-0 pointer-events-none" style={{ width: displayW, height: displayH }} />

          {/* Tap overlay */}
          <div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ touchAction: "none", cursor: "text", zIndex: 10 }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onTouchEnd={handleTouchEnd}
            onPointerCancel={(e) => { pointersRef.current.delete(e.pointerId); pinchRef.current = null; tapStartRef.current = null; }}
          >
            {items.map((it) => {
              const isEditing = editingId === it.id;
              const isSelected = selectedId === it.id;
              const left = it.xPercent * displayW;
              const top = it.yPercent * displayH;
              const fontPx = it.fontSize * effectiveScale;
              return (
                <div
                  key={it.id}
                  data-text-item
                  className={`absolute ${isSelected && !isEditing ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  style={{ left, top, fontSize: fontPx, fontFamily: FONT_FAMILY, color: it.color, lineHeight: 1.1 }}
                  onPointerDown={(e) => { e.stopPropagation(); setSelectedId(it.id); }}
                  onPointerUp={(e) => { e.stopPropagation(); if (!isEditing) beginEdit(it.id); }}
                >
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={it.text}
                      onChange={(e) => setItems((prev) => prev.map((p) => p.id === it.id ? { ...p, text: e.target.value } : p))}
                      onBlur={(e) => commitEdit(it.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                        if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); }
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: fontPx, fontFamily: FONT_FAMILY, color: it.color,
                        background: "rgba(255,255,255,0.85)", border: "1px solid hsl(var(--primary))",
                        outline: "none", padding: "2px 6px", borderRadius: 4, minWidth: 80,
                        lineHeight: 1.1,
                      }}
                    />
                  ) : (
                    <span style={{ background: "rgba(255,255,255,0.6)", padding: "0 2px", whiteSpace: "pre" }}>
                      {it.text || " "}
                    </span>
                  )}
                  {isSelected && !isEditing && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                      className="absolute -top-3 -right-3 h-7 w-7 rounded-full bg-destructive text-destructive-foreground shadow-md flex items-center justify-center"
                      aria-label="Διαγραφή"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}

            {sigs.map((s) => {
              const isSelected = selectedId === s.id;
              const left = s.xPercent * displayW;
              const top = s.yPercent * displayH;
              const w = s.widthPercent * displayW;
              return (
                <div
                  key={s.id} data-sig-item
                  className={`absolute ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  style={{ left, top, width: w }}
                  onPointerDown={(e) => { e.stopPropagation(); setSelectedId(s.id); }}
                >
                  <img src={s.dataUrl} alt="" draggable={false} style={{ width: "100%", display: "block" }} />
                  {isSelected && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeSig(s.id); }}
                      className="absolute -top-3 -right-3 h-7 w-7 rounded-full bg-destructive text-destructive-foreground shadow-md flex items-center justify-center"
                      aria-label="Διαγραφή"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {items.length === 0 && sigs.length === 0 && (
          <div className="mt-3 text-center text-xs text-muted-foreground">
            Πάτα οπουδήποτε στο έγγραφο για να γράψεις.
          </div>
        )}
      </div>

      {/* Sticky bottom toolbar */}
      {!keyboardOpen && (
        <div
          className="fixed left-0 right-0 z-40 border-t bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
          style={{ bottom: 0, paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto max-w-3xl px-3 py-2 flex items-center gap-2">
            {/* Font size */}
            <div className="h-[52px] flex items-center rounded-xl border bg-background overflow-hidden">
              <button onClick={() => adjustSize(-2)} className="h-full w-10 flex items-center justify-center" aria-label="Μικρότερο κείμενο">
                <Minus className="h-4 w-4" />
              </button>
              <span className="px-1 text-xs tabular-nums min-w-[28px] text-center">
                {selectedId ? items.find((i) => i.id === selectedId)?.fontSize ?? defaultFontSize : defaultFontSize}
              </span>
              <button onClick={() => adjustSize(+2)} className="h-full w-10 flex items-center justify-center" aria-label="Μεγαλύτερο κείμενο">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Zoom */}
            <div className="flex h-[52px] items-center rounded-xl border bg-background overflow-hidden">
              <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} className="h-full w-10 flex items-center justify-center" aria-label="Σμίκρυνση">
                <Minus className="h-4 w-4" />
              </button>
              <span className="px-1 text-xs tabular-nums min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))} className="h-full w-10 flex items-center justify-center" aria-label="Μεγέθυνση">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Delete selected */}
            <button
              onClick={() => {
                if (!selectedId) return;
                if (items.find((i) => i.id === selectedId)) removeItem(selectedId);
                else if (sigs.find((s) => s.id === selectedId)) removeSig(selectedId);
              }}
              disabled={!selectedId}
              className="h-[52px] px-3 rounded-xl border bg-background text-destructive disabled:opacity-40 flex items-center justify-center"
              aria-label="Διαγραφή επιλεγμένου"
            >
              <Trash2 className="h-5 w-5" />
            </button>

            {/* Signature */}
            <button
              onClick={() => setSigSheet(true)}
              className="h-[52px] px-3 rounded-xl border bg-background flex items-center justify-center gap-1.5"
              aria-label="Υπογραφή"
            >
              <PenLine className="h-5 w-5" />
              <span className="hidden sm:inline text-sm font-medium">Υπογραφή</span>
            </button>

            <div className="flex-1" />

            {/* Export */}
            <button
              onClick={startExportFlow}
              disabled={phase === "exporting"}
              className="h-[52px] px-5 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {phase === "exporting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              <span>PDF</span>
            </button>
          </div>
        </div>
      )}

      {/* Crop dialog (before export) */}
      <Dialog open={cropOpen} onOpenChange={(open) => { if (!open) onCropSkip(); }}>
        <DialogContent
          className="max-w-3xl"
          onPointerDownCapture={cancelCropTimer}
        >
          <DialogHeader>
            <DialogTitle>Κόψε το περιττό φόντο</DialogTitle>
          </DialogHeader>
          {bg && (
            <CropPreview
              dataUrl={bg.dataUrl}
              onConfirm={onCropConfirm}
              onSkip={onCropSkip}
            />
          )}
          <p className="text-xs text-muted-foreground">Αν δεν κάνεις τίποτα, θα γίνει αυτόματη παράλειψη σε 3 δευτερόλεπτα.</p>
        </DialogContent>
      </Dialog>

      {/* Export overlay */}
      {phase === "exporting" && (
        <div className="fixed inset-0 z-[60] bg-background/95 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="text-base font-semibold">Δημιουργία PDF…</div>
          <div className="text-xs text-muted-foreground">Λίγα δευτερόλεπτα</div>
        </div>
      )}

      {/* Signature sheet */}
      <Sheet open={sigSheet} onOpenChange={setSigSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Υπογραφή</SheetTitle></SheetHeader>
          <div className="mt-4">
            <SignaturePad onCancel={() => setSigSheet(false)} onSave={addSignature} />
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} onResolved={() => bg && void doExport(bg)} />
    </>
  );
}
