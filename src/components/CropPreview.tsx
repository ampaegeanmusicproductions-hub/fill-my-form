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

function withTimeout<T>(promise: Promise<T>, message: string, ms = CROP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
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
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxX = Math.min(image.naturalWidth, Math.ceil(Math.max(...xs)));
  const maxY = Math.min(image.naturalHeight, Math.ceil(Math.max(...ys)));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Αδυναμία επεξεργασίας εικόνας");

  context.drawImage(image, minX, minY, width, height, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    w: width,
    h: height,
  };
}

export function CropPreview({ dataUrl, onConfirm, onSkip }: Props) {
  const [loading, setLoading] = useState(true);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [corners, setCorners] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const image = await withTimeout(loadImage(dataUrl), "Η προεπισκόπηση περικοπής άργησε πολύ.");
        if (!alive) return;
        const W = image.naturalWidth;
        const H = image.naturalHeight;
        setImgSize({ w: W, h: H });
        setCorners([
          { x: 0, y: 0 },
          { x: W, y: 0 },
          { x: W, y: H },
          { x: 0, y: H },
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
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = i;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current === null || !corners || !imgSize || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(imgSize.w, (e.clientX - rect.left) / scale));
    const y = Math.max(0, Math.min(imgSize.h, (e.clientY - rect.top) / scale));
    const next = [...corners] as [Pt, Pt, Pt, Pt];
    next[dragRef.current] = { x, y };
    setCorners(next);
  };
  const onPointerUp = () => { dragRef.current = null; };

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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onSkip}>Παράλειψη</Button>
          <Button size="sm" onClick={confirm}>Συνέχεια</Button>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative mx-auto rounded-xl border overflow-hidden bg-muted/30 select-none"
        style={{ width: dW, height: dH, maxWidth: "100%" }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img src={dataUrl} alt="" className="absolute inset-0 pointer-events-none" style={{ width: dW, height: dH }} />
        <svg className="absolute inset-0 pointer-events-none" width={dW} height={dH}>
          <polygon points={polyPts} fill="rgba(59,130,246,0.15)" stroke="rgb(59,130,246)" strokeWidth={2} />
        </svg>
        {corners.map((p, i) => (
          <div
            key={i}
            onPointerDown={onPointerDown(i)}
            className="absolute h-6 w-6 rounded-full bg-primary border-2 border-white shadow cursor-grab touch-none"
            style={{ left: p.x * scale - 12, top: p.y * scale - 12 }}
          />
        ))}
      </div>
    </div>
  );
}
