import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PDFDocument, rgb } from "pdf-lib";
import { Loader2, Upload, Download, Trash2, Plus, Minus, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { consumeQuota, saveDocument } from "@/lib/quota.functions";
import { detectFields, type DetectedField } from "@/lib/detect-fields.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { SignaturePad } from "@/components/SignaturePad";

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase = "idle" | "preparing" | "detecting" | "ready" | "exporting";

type TextItem = {
  id: string;
  xPct: number; // 0..1 relative to natural image size
  yPct: number;
  text: string;
  fontSize: number; // px at 1x scale (natural image width)
  color: string;
};

type SigItem = {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  dataUrl: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const MAX_RENDER_W = 1400;
const FONT = "system-ui, Arial, sans-serif";
const QUICK_LABELS = ["Ονοματεπώνυμο", "ΑΦΜ", "ΑΔΤ", "Διεύθυνση", "Τηλέφωνο", "Ημερομηνία"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);

const todayGr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const sanitize = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function fileToImageData(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
  const lower = file.name.toLowerCase();

  // HEIC/HEIF → JPEG
  let blob: Blob = file;
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    const heic2any = (await import("heic2any")).default;
    blob = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 })) as Blob;
  }

  // PDF → render first page
  if (lower.endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_RENDER_W / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, canvas }).promise;
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), w: canvas.width, h: canvas.height };
  }

  // Image
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    const scale = Math.min(1, MAX_RENDER_W / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export function PdfEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement>(null);

  // Core state
  const [phase, setPhase] = useState<Phase>("idle");
  const [bg, setBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  // Items
  const [items, setItems] = useState<TextItem[]>([]);
  const [sigs, setSigs] = useState<SigItem[]>([]);
  const [aiFields, setAiFields] = useState<(DetectedField & { value: string })[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // UI
  const [fontSize, setFontSize] = useState(18);
  const [zoom, setZoom] = useState(1.0); // user zoom multiplier
  const [displayScale, setDisplayScale] = useState(1.0); // fit-to-container scale
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [sigSheet, setSigSheet] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [profileChips, setProfileChips] = useState<{ label: string; value: string }[]>([]);
  const [quickSheet, setQuickSheet] = useState(false);

  const consume = useServerFn(consumeQuota);
  const save = useServerFn(saveDocument);
  const detect = useServerFn(detectFields);

  // ── Fit-to-container scale ─────────────────────────────────────────────────
  useEffect(() => {
    if (!bg) return;
    const update = () => {
      const cw = containerRef.current?.clientWidth ?? window.innerWidth;
      setDisplayScale(Math.min(1, cw / bg.w));
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bg]);

  // ── Mobile keyboard detection ──────────────────────────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboardVisible(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // ── Profile chips ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const load = async (uid: string) => {
      const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
      if (!data || !alive) return;
      const p = data as unknown as Record<string, string | null>;
      const addr = [p.address_street, p.address_number].filter(Boolean).join(" ");
      setProfileChips([
        { label: "Ονοματεπώνυμο", value: p.full_name ?? "" },
        { label: "ΑΦΜ", value: p.afm ?? "" },
        { label: "ΑΔΤ", value: p.id_number ?? "" },
        { label: "Τηλέφωνο", value: p.phone ?? "" },
        { label: "Διεύθυνση", value: addr },
      ].filter(c => c.value.trim()));
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user && alive) load(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => {
      if (!alive) return;
      if (s?.user) load(s.user.id); else setProfileChips([]);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // ── Auto-focus when editing starts ─────────────────────────────────────────
  useEffect(() => {
    if (editingId && activeInputRef.current) {
      setTimeout(() => activeInputRef.current?.focus({ preventScroll: true }), 60);
    }
  }, [editingId]);

  // ── Computed display size ──────────────────────────────────────────────────
  const totalScale = displayScale * zoom;
  const dispW = bg ? bg.w * totalScale : 0;
  const dispH = bg ? bg.h * totalScale : 0;

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
      toast.info("Τα Word αρχεία δεν υποστηρίζονται ακόμα. Χρησιμοποίησε PDF ή φωτογραφία.");
      return;
    }
    setPhase("preparing");
    setBg(null); setItems([]); setSigs([]); setAiFields([]); setEditingId(null); setSelectedId(null);
    setOriginalFile(file);
    try {
      const out = await fileToImageData(file);
      setBg(out);
      setZoom(1.0);
      setPhase("detecting");

      // AI field detection (non-blocking failure → manual mode)
      try {
        const m = out.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          const result = await detect({ data: { imageBase64: m[2], mimeType: m[1] } });
          const fields = (result?.fields ?? []) as DetectedField[];
          if (fields.length > 0) {
            setAiFields(fields.map(f => ({ ...f, value: "" })));
            toast.success(`Εντοπίστηκαν ${fields.length} πεδία`);
          } else {
            toast.info("Δεν εντοπίστηκαν πεδία — πάτα οπουδήποτε για να γράψεις");
          }
        }
      } catch (e) {
        console.warn("[detect] failed:", e);
        toast.info("Δεν εντοπίστηκαν πεδία — πάτα οπουδήποτε για να γράψεις");
      }
      setPhase("ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Σφάλμα κατά τη φόρτωση.");
      setPhase("idle"); setOriginalFile(null);
    }
  }, [detect]);

  const reset = () => {
    setBg(null); setItems([]); setSigs([]); setAiFields([]);
    setEditingId(null); setSelectedId(null);
    setOriginalFile(null); setPhase("idle");
    setZoom(1.0);
  };

  // ── Tap/click to add text ──────────────────────────────────────────────────
  const handleOverlayTap = useCallback(async (clientX: number, clientY: number) => {
    // If we're editing, commit first then wait
    if (editingId) {
      if (activeInputRef.current) activeInputRef.current.blur();
      await new Promise(r => setTimeout(r, 80));
    }

    // Check if tapped on existing item
    const el = document.elementFromPoint(clientX, clientY);
    if (el?.closest("[data-item]")) return;

    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;

    const xPct = Math.max(0, Math.min(1, (clientX - rect.left) / dispW));
    const yPct = Math.max(0, Math.min(1, (clientY - rect.top) / dispH));

    const id = uid();
    setItems(prev => [...prev, { id, xPct, yPct, text: "", fontSize, color: "#000000" }]);
    setSelectedId(id);
    setEditingId(id);
  }, [editingId, dispW, dispH, fontSize]);

  const commitEdit = (id: string, text: string) => {
    setItems(prev => {
      const next = prev.map(it => it.id === id ? { ...it, text } : it);
      return next.filter(it => it.id !== id || it.text.trim().length > 0);
    });
    setEditingId(null);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(it => it.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  };

  const removeSig = (id: string) => {
    setSigs(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const adjustFontSize = (delta: number) => {
    const newSize = Math.max(8, Math.min(80, fontSize + delta));
    setFontSize(newSize);
    if (selectedId) {
      setItems(prev => prev.map(it => it.id === selectedId ? { ...it, fontSize: newSize } : it));
    }
  };

  const insertQuick = (label: string, value: string) => {
    setQuickSheet(false);
    const text = label === "Ημερομηνία" && !value ? todayGr() : value;
    if (!text) return;
    const id = uid();
    setItems(prev => [...prev, { id, xPct: 0.05, yPct: 0.05, text, fontSize, color: "#000000" }]);
    setSelectedId(id);
    setEditingId(id);
  };

  const addSignature = (dataUrl: string) => {
    setSigSheet(false);
    const id = uid();
    setSigs(prev => [...prev, { id, xPct: 0.1, yPct: 0.75, wPct: 0.25, dataUrl }]);
    setSelectedId(id);
  };

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const exportPdf = async () => {
    if (!bg || !originalFile) return;
    setPhase("exporting");
    try {
      // Quota check (only for logged-in users)
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (user) {
        try {
          unwrapServerFn<{ source: "premium" | "credit" | "free" }>(await consume());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("QUOTA_EXCEEDED") || msg.includes("όριο")) {
            setUpgradeOpen(true); setPhase("ready"); return;
          }
          throw e;
        }
      }

      // Composite: bg + text + sigs on canvas
      const baseImg = await loadImg(bg.dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = bg.w; canvas.height = bg.h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, bg.w, bg.h);
      ctx.drawImage(baseImg, 0, 0);

      ctx.textBaseline = "top";
      for (const it of items) {
        if (!it.text.trim()) continue;
        ctx.font = `${it.fontSize}px ${FONT}`;
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, it.xPct * bg.w, it.yPct * bg.h);
      }

      for (const s of sigs) {
        try {
          const sImg = await loadImg(s.dataUrl);
          const w = s.wPct * bg.w;
          const h = (sImg.naturalHeight / sImg.naturalWidth) * w;
          ctx.drawImage(sImg, s.xPct * bg.w, s.yPct * bg.h, w, h);
        } catch { /* skip broken sig */ }
      }

      // Build PDF (A4)
      const jpegBytes = await (await fetch(canvas.toDataURL("image/jpeg", 0.95))).arrayBuffer();
      const A4w = 595, A4h = 842;
      const pageW = bg.w > bg.h ? A4h : A4w;
      const pageH = bg.w > bg.h ? A4w : A4h;
      const margin = 16;
      const fit = Math.min((pageW - margin * 2) / bg.w, (pageH - margin * 2) / bg.h);
      const dw = bg.w * fit, dh = bg.h * fit;
      const dx = (pageW - dw) / 2, dy = (pageH - dh) / 2;

      const pdfDoc = await PDFDocument.create();
      const jpg = await pdfDoc.embedJpg(jpegBytes);
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });
      page.drawImage(jpg, { x: dx, y: dy, width: dw, height: dh });
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

      // Save to Supabase (non-blocking)
      if (user) {
        try {
          const ts = Date.now();
          const baseName = sanitize(originalFile.name.replace(/\.[^.]+$/, ""));
          const safeFull = sanitize(originalFile.name);
          const folder = `${user.id}/${ts}_${baseName}`;
          await Promise.all([
            supabase.storage.from("originals").upload(`${folder}/original_${safeFull}`, originalFile, { upsert: true }),
            supabase.storage.from("filled").upload(`${folder}/filled.pdf`, pdfBlob, { upsert: true }),
          ]);
          unwrapServerFn(await save({
            data: {
              name: baseName,
              originalFilePath: `${folder}/original_${safeFull}`,
              normalizedPdfPath: `${folder}/original_${safeFull}`, // reuse original
              filledFilePath: `${folder}/filled.pdf`,
              fields: [...items, ...sigs] as unknown[],
            },
          }));
        } catch (e) { console.warn("[export] save failed (non-blocking):", e); }
      }

      // Download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${originalFile.name.replace(/\.[^.]+$/, "")}-συμπληρωμένο.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Το PDF κατέβηκε!");
    } catch (e) {
      console.error("[export]", e);
      toast.error(e instanceof Error ? e.message : "Σφάλμα κατά την εξαγωγή.");
    } finally {
      setPhase("ready");
    }
  };

  // ── RENDER: idle/preparing ─────────────────────────────────────────────────
  if (!bg) {
    return (
      <div
        className="border-2 border-dashed rounded-2xl p-10 sm:p-16 text-center cursor-pointer hover:border-primary transition-colors bg-card"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        role="button" tabIndex={0}
      >
        <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {phase === "preparing" ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="font-medium">Επεξεργασία αρχείου…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">Σύρετε ή επιλέξτε αρχείο</p>
              <p className="text-sm text-muted-foreground mt-1">PDF, εικόνα ή φωτογραφία από κινητό</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── RENDER: editor ─────────────────────────────────────────────────────────
  return (
    <>
      {/* Document + overlay */}
      <div ref={containerRef} className="w-full overflow-auto">
        <div
          className="relative mx-auto bg-white shadow rounded-xl border overflow-hidden select-none"
          style={{ width: dispW, height: dispH }}
        >
          {/* Background image */}
          <img
            src={bg.dataUrl} alt="Έγγραφο" draggable={false}
            className="absolute inset-0 pointer-events-none"
            style={{ width: dispW, height: dispH }}
          />

          {/* Tap overlay */}
          <div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ touchAction: "none", cursor: "text" }}
            onPointerDown={e => {
              // Desktop only — mobile uses onTouchEnd
              if (e.pointerType === "mouse") handleOverlayTap(e.clientX, e.clientY);
            }}
            onTouchEnd={e => {
              e.preventDefault();
              const t = e.changedTouches[0];
              if (t) handleOverlayTap(t.clientX, t.clientY);
            }}
          >
            {/* Text items */}
            {items.map(it => {
              const isEditing = editingId === it.id;
              const isSelected = selectedId === it.id;
              const fontPx = it.fontSize * totalScale;
              return (
                <div
                  key={it.id}
                  data-item
                  className="absolute"
                  style={{ left: it.xPct * dispW, top: it.yPct * dispH, fontSize: fontPx, fontFamily: FONT, color: it.color, lineHeight: 1.15 }}
                  onPointerDown={e => { e.stopPropagation(); setSelectedId(it.id); }}
                  onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); setSelectedId(it.id); if (!isEditing) setEditingId(it.id); }}
                  onClick={e => { e.stopPropagation(); if (!isEditing) setEditingId(it.id); }}
                >
                  {isEditing ? (
                    <input
                      ref={activeInputRef}
                      type="text"
                      defaultValue={it.text}
                      onBlur={e => commitEdit(it.id, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") { setItems(prev => prev.filter(p => p.id !== it.id || p.text.trim())); setEditingId(null); }
                      }}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: fontPx, fontFamily: FONT, color: it.color,
                        background: "rgba(255,255,255,0.97)",
                        border: "2px solid hsl(var(--primary))",
                        borderRadius: 4, padding: "1px 6px",
                        outline: "none", minWidth: 80, lineHeight: 1.15,
                      }}
                    />
                  ) : (
                    <span style={{ background: "rgba(255,255,255,0.75)", padding: "0 3px", whiteSpace: "pre", borderRadius: 2, outline: isSelected ? "2px solid hsl(var(--primary))" : "none" }}>
                      {it.text}
                    </span>
                  )}
                  {isSelected && !isEditing && (
                    <button
                      data-item
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); removeItem(it.id); }}
                      className="absolute -top-3 -right-3 h-6 w-6 rounded-full bg-destructive text-white shadow flex items-center justify-center text-xs font-bold"
                    >✕</button>
                  )}
                </div>
              );
            })}

            {/* AI-detected fields */}
            {aiFields.map(f => {
              const w = Math.max(60, f.widthPct * dispW);
              const h = Math.max(20, f.heightPct * dispH);
              const fontPx = Math.max(12, h * 0.65);
              const isMulti = f.type === "multiline";
              const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                const v = e.target.value;
                setAiFields(prev => prev.map(p => p.id === f.id ? { ...p, value: v } : p));
              };
              const baseStyle: React.CSSProperties = {
                width: w,
                height: isMulti ? Math.max(h, fontPx * 2.4) : h,
                fontSize: fontPx,
                fontFamily: FONT,
                color: "#0a3a8c",
                background: "rgba(255,255,255,0.85)",
                border: "none",
                borderBottom: "2px solid hsl(var(--primary))",
                borderRadius: 2,
                padding: "0 4px",
                outline: "none",
                lineHeight: 1.1,
                resize: "none",
                boxSizing: "border-box",
              };
              return (
                <div
                  key={f.id}
                  data-item
                  className="absolute"
                  style={{ left: f.xPct * dispW, top: f.yPct * dispH }}
                  title={f.label}
                  onPointerDown={e => e.stopPropagation()}
                  onTouchEnd={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                >
                  {isMulti ? (
                    <textarea
                      value={f.value}
                      placeholder={f.label}
                      onChange={onChange}
                      style={baseStyle}
                    />
                  ) : (
                    <input
                      type="text"
                      inputMode={f.type === "date" ? "numeric" : "text"}
                      value={f.value}
                      placeholder={f.label}
                      onChange={onChange}
                      style={baseStyle}
                    />
                  )}
                </div>
              );
            })}

            {/* Signature items */}
            {sigs.map(s => {
              const isSelected = selectedId === s.id;
              const w = s.wPct * dispW;
              return (
                <div
                  key={s.id}
                  data-item
                  className="absolute"
                  style={{ left: s.xPct * dispW, top: s.yPct * dispH, width: w, outline: isSelected ? "2px solid hsl(var(--primary))" : "none" }}
                  onPointerDown={e => { e.stopPropagation(); setSelectedId(s.id); }}
                  onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); setSelectedId(s.id); }}
                >
                  <img src={s.dataUrl} alt="Υπογραφή" draggable={false} style={{ width: "100%", display: "block" }} />
                  {isSelected && (
                    <button
                      data-item
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); removeSig(s.id); }}
                      className="absolute -top-3 -right-3 h-6 w-6 rounded-full bg-destructive text-white shadow flex items-center justify-center text-xs font-bold"
                    >✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {items.length === 0 && sigs.length === 0 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Πάτα οπουδήποτε στο έγγραφο για να γράψεις
          </p>
        )}
      </div>

      {/* ── Bottom toolbar ── */}
      {!keyboardVisible && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur-sm shadow-lg"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto max-w-2xl px-2 py-2 flex items-center gap-1.5">

            {/* Font size */}
            <div className="flex items-center rounded-xl border bg-card overflow-hidden h-12">
              <button onClick={() => adjustFontSize(-2)} className="h-full px-3 flex items-center justify-center active:bg-muted">
                <Minus className="h-4 w-4" />
              </button>
              <span className="px-1 text-xs tabular-nums min-w-[28px] text-center">{
                selectedId ? (items.find(i => i.id === selectedId)?.fontSize ?? fontSize) : fontSize
              }</span>
              <button onClick={() => adjustFontSize(2)} className="h-full px-3 flex items-center justify-center active:bg-muted">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Zoom */}
            <div className="flex items-center rounded-xl border bg-card overflow-hidden h-12">
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="h-full px-3 flex items-center active:bg-muted">
                <Minus className="h-3 w-3" />
              </button>
              <span className="px-1 text-xs tabular-nums min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="h-full px-3 flex items-center active:bg-muted">
                <Plus className="h-3 w-3" />
              </button>
            </div>

            {/* Delete selected */}
            <button
              onClick={() => {
                if (!selectedId) return;
                if (items.find(i => i.id === selectedId)) removeItem(selectedId);
                else if (sigs.find(s => s.id === selectedId)) removeSig(selectedId);
              }}
              disabled={!selectedId}
              className="h-12 px-3 rounded-xl border bg-card text-destructive disabled:opacity-30 flex items-center justify-center"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* Signature */}
            <button
              onClick={() => setSigSheet(true)}
              className="h-12 px-3 rounded-xl border bg-card flex items-center justify-center"
            >
              <PenLine className="h-4 w-4" />
            </button>

            {/* New file */}
            <button
              onClick={reset}
              className="h-12 px-3 rounded-xl border bg-card flex items-center justify-center"
              title="Νέο αρχείο"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            {/* Export PDF */}
            <button
              onClick={exportPdf}
              disabled={phase === "exporting"}
              className="h-12 flex-1 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 min-w-[72px]"
            >
              {phase === "exporting"
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />}
              <span>PDF</span>
            </button>
          </div>
        </div>
      )}

      {/* Export overlay */}
      {phase === "exporting" && (
        <div className="fixed inset-0 z-[60] bg-background/95 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="font-semibold">Δημιουργία PDF…</p>
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

      {/* Quick profile sheet */}
      <Sheet open={quickSheet} onOpenChange={setQuickSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Στοιχεία μου</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {QUICK_LABELS.map(label => {
              const chip = profileChips.find(c => c.label === label);
              return (
                <button
                  key={label}
                  onClick={() => insertQuick(label, chip?.value ?? "")}
                  className="text-left rounded-lg border bg-card hover:bg-accent px-3 py-3"
                >
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-sm font-medium truncate">
                    {label === "Ημερομηνία" ? todayGr() : (chip?.value || "Συμπλήρωσε…")}
                  </div>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} onResolved={exportPdf} />
    </>
  );
}
