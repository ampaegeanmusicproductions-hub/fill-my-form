import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { mockBuyCredit, mockSubscribe } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { toast } from "sonner";
import { Sparkles, ShoppingBag } from "lucide-react";

export function UpgradeModal({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResolved: () => void;
}) {
  const buyCredit = useServerFn(mockBuyCredit);
  const subscribe = useServerFn(mockSubscribe);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Έφτασες το όριο της δωρεάν δοκιμής</DialogTitle>
          <DialogDescription>
            Έχεις χρησιμοποιήσει τη δωρεάν δοκιμή σου (1 έγγραφο). Για να συνεχίσεις, διάλεξε:
          </DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <button
            onClick={async () => {
              try {
                const r = unwrapServerFn(await buyCredit());
                toast.success(`Προστέθηκε 1 credit (mock). Σύνολο: ${r.credits}`);
                onOpenChange(false);
                onResolved();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Σφάλμα");
              }
            }}
            className="text-left rounded-xl border p-5 hover:border-primary hover:shadow-sm transition"
          >
            <div className="flex items-center gap-2 font-semibold">
              <ShoppingBag className="h-5 w-5 text-primary" /> Αγορά για €1
            </div>
            <div className="text-sm text-muted-foreground mt-1">Πλήρωσε μία φορά για ένα μόνο έγγραφο.</div>
            <div className="text-xs text-muted-foreground mt-3">Mock — προσομοιώνει την αγορά</div>
          </button>
          <button
            onClick={async () => {
              try {
                unwrapServerFn(await subscribe());
                toast.success("Premium ενεργό (mock). Απεριόριστα έγγραφα!");
                onOpenChange(false);
                onResolved();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Σφάλμα");
              }
            }}
            className="text-left rounded-xl border-2 border-primary p-5 bg-primary/5 hover:shadow-md transition"
          >
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-5 w-5 text-gold" /> Premium €4.99/μήνα
            </div>
            <div className="text-sm text-muted-foreground mt-1">Απεριόριστα έγγραφα κάθε μήνα.</div>
            <div className="text-xs text-muted-foreground mt-3">Mock — προσομοιώνει συνδρομή</div>
          </button>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Σημείωση: Τα κουμπιά είναι σε δοκιμαστική λειτουργία. Η σύνδεση με Stripe προστίθεται σε επόμενη φάση.
        </div>
      </DialogContent>
    </Dialog>
  );
}
