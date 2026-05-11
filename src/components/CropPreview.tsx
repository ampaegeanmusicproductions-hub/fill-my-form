import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Props = {
  dataUrl: string;
  onConfirm: (out: { dataUrl: string; w: number; h: number }) => void;
  onSkip: () => void;
};

export type Pt = { x: number; y: number };

const CROP_TIMEOUT_MS = 5_000;
const SNAP_RADIUS = 30;
const SNAP_THRESHOLD = 110;

function withTimeout<T>(promise: Promise<T>, message: string, ms = CROP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => { window.clearTimeout(timer); resolve(value); })
      .catch((error) => { window.clearTimeout(timer); reject(error); });
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Αδυναμία φόρτωσης εικόνας"));
    image.src = src;
  });
}

async function cropImage(
  dataUrl: string,
  corners: [Pt, Pt, Pt, Pt],
): Promise<{ dataUrl: string; w: number; h: number }> {
  const image = await withTimeout(loadImage(dataUrl), "Η φόρτωση της εικόνας άργησε πολύ.");
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxX = Math.min(image.naturalWidth, Math.ceil(Math.max(...xs)));
  const maxY = Math.min(image.naturalHeight, Math.ceil(Math.max(...ys)));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Αδυναμία επεξεργασίας εικόνας");
  ctx.drawImage(image, minX, minY, width, height, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), w: width, h: height };
}

function snapToEdge(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const x0 = Math.max(1, Math.floor(cx - SNAP_RADIUS));
  const y0 = Math.max(1, Math.floor(cy - SNAP_RADIUS));
  const x1 = Math.min(W - 2, Math.ceil(cx + SNAP_RADIUS));
  const y1 = Math.min(H - 2, Math.ceil(cy + SNAP_RADIUS));
  if (x1 <= x0 || y1 <= y0) return null;
  const lum = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let bestMag = 0, bestX = -1, bestY = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const gx =
        -lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1) +
        lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) +
        lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
      const mag = Math.hypot(gx, gy);
      if (mag > bestMag) { bestMag = mag; bestX = x; bestY = y; }
    }
  }
  if (bestMag < SNAP_THRESHOLD || bestX < 0) return null;
  return { x: bestX, y: bestY };
}

export function CropPreview({ dataUrl, onConfirm, onSkip }: Props) {
  const [loading, setLoading] = useState(true);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [corners, setCorners] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  const [scale, setScale] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapped, setSnapped] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ idx: number; offX: number; offY: number; startX: number; startY: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pixelsRef = useRef<{ data: Uint8ClampedArray; w: number; h: number; ratio: number } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const image = await withTimeout(loadImage(dataUrl), "Η προεπισκόπηση περικοπής άργησε πολύ.");
        if (!alive) return;
        imageRef.current = image;
        setImgSize({ w: image.naturalWidth, h: image.naturalHeight });
        setCorners([
          { x: 0, y: 0 },
          { x: image.naturalWidth, y: 0 },
          { x: image.naturalWidth, y: image.naturalHeight },
          { x: 0, y: image.naturalHeight },
        ]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Η περικοπή δεν φόρτωσε εγκαίρως.");
        onSkip();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [dataUrl, onSkip]);

  // Lazy + downsampled pixel buffer for snapping (mobile-safe).
  const ensurePixels = () => {
    if (pixelsRef.current || !imageRef.current) return pixelsRef.current;
    try {
      const img = imageRef.current;
      const MAX = 1024;
      const ratio = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * ratio));
      const h = Math.max(1, Math.round(img.naturalHeight * ratio));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      pixelsRef.current = { data: ctx.getImageData(0, 0, w, h).data, w, h, ratio };
      return pixelsRef.current;
    } catch (err) {
      console.warn("[CropPreview] snap unavailable:", err);
      return null;
    }
  };

  useEffect(() => {
    if (!imgSize) return;
    const update = () => {
      const w = wrapRef.current?.clientWidth ?? imgSize.w;
      const maxH = Math.max(300, window.innerHeight - 280);
      setScale(Math.min(1, w / imgSize.w, maxH / imgSize.h));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [imgSize]);

  const onPointerDown = (i: number) => (e: React.PointerEvent) => {
    if (!corners || !wrapRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = wrapRef.current.getBoundingClientRect();
    // pointer position in image coords
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    dragRef.current = {
      idx: i,
      offX: corners[i].x - px,
      offY: corners[i].y - py,
      startX: corners[i].x,
      startY: corners[i].y,
    };
    setActiveIdx(i);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !corners || !imgSize || !wrapRef.current) return;
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    let x = (e.clientX - rect.left) / scale + d.offX;
    let y = (e.clientY - rect.top) / scale + d.offY;
    // constrain inside image
    x = Math.max(0, Math.min(imgSize.w, x));
    y = Math.max(0, Math.min(imgSize.h, y));
    let didSnap = false;
    if (snapEnabled && pixelsRef.current) {
      const p = snapToEdge(pixelsRef.current.data, pixelsRef.current.w, pixelsRef.current.h, x, y);
      if (p) { x = p.x; y = p.y; didSnap = true; }
    }
    const next = [...corners] as [Pt, Pt, Pt, Pt];
    next[d.idx] = { x, y };
    setCorners(next);
    setSnapped((prev) => {
      const out = [...prev] as [boolean, boolean, boolean, boolean];
      out[d.idx] = didSnap;
      return out;
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    }
    dragRef.current = null;
    setActiveIdx(null);
  };

  const confirm = async () => {
    if (!corners) return;
    setLoading(true);
    try {
      const out = await withTimeout(cropImage(dataUrl, corners), "Η περικοπή άργησε πολύ. Χρησιμοποιείται η αρχική εικόνα.");
      onConfirm(out);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Σφάλμα περικοπής. Χρήση αρχικής εικόνας.");
      onSkip();
    }
  };

  if (loading || !imgSize || !corners) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <div className="text-muted-foreground">Επεξεργασία εγγράφου…</div>
      </div>
    );
  }

  const dW = imgSize.w * scale;
  const dH = imgSize.h * scale;
  const polyPts = corners.map((p) => `${p.x * scale},${p.y * scale}`).join(" ");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border bg-card">
        <div className="text-sm">
          Σύρε τις 4 γωνίες για να ορίσεις το έγγραφο και πάτα <strong>Συνέχεια</strong>.
        </div>
        <div className="flex gap-2 items-center">
          <Button
            size="sm"
            variant={snapEnabled ? "default" : "outline"}
            onClick={() => setSnapEnabled((v) => !v)}
            title="Αυτόματο κόλλημα στις άκρες"
          >
            Auto-snap: {snapEnabled ? "ON" : "OFF"}
          </Button>
          <Button size="sm" variant="outline" onClick={onSkip}>Παράλειψη</Button>
          <Button size="sm" onClick={confirm}>Συνέχεια</Button>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative mx-auto rounded-xl border overflow-hidden bg-muted/30 select-none touch-none"
        style={{ width: dW, height: dH, maxWidth: "100%" }}
      >
        <img
          src={dataUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 pointer-events-none"
          style={{ width: dW, height: dH, zIndex: 1 }}
        />
        <svg
          className="absolute inset-0 pointer-events-none"
          width={dW}
          height={dH}
          style={{ zIndex: 2 }}
        >
          <polygon points={polyPts} fill="rgba(59,130,246,0.15)" stroke="rgb(59,130,246)" strokeWidth={2} />
        </svg>
        {corners.map((p, i) => {
          const isActive = activeIdx === i;
          const size = isActive ? 32 : 24;
          const bg = isActive ? "rgb(234,179,8)" : snapped[i] ? "rgb(34,197,94)" : "hsl(var(--primary))";
          return (
            <div
              key={i}
              onPointerDown={onPointerDown(i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="absolute rounded-full border-2 border-white shadow-lg cursor-grab active:cursor-grabbing touch-none transition-[width,height,background-color] duration-100"
              style={{
                left: p.x * scale - size / 2,
                top: p.y * scale - size / 2,
                width: size,
                height: size,
                backgroundColor: bg,
                zIndex: 10,
                touchAction: "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
