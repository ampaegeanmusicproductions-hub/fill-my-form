import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, signOut } from "@/lib/use-auth";
import { getMyProfile, updateMyProfile } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { Sparkles, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Λογαριασμός — FormFill.gr" }, { name: "description", content: "Διαχείριση λογαριασμού και συνδρομής." }] }),
  component: AccountPage,
});

type Profile = {
  subscription_status: string;
  pay_per_use_credits: number;
  total_documents_used: number;
  full_name?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  afm?: string | null;
  amka?: string | null;
  id_number?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_postal?: string | null;
  address_city?: string | null;
  address_region?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
};

const FIELDS: { key: keyof Profile; label: string; type?: string; col?: string }[] = [
  { key: "full_name", label: "Ονοματεπώνυμο", col: "sm:col-span-2" },
  { key: "father_name", label: "Όνομα Πατέρα" },
  { key: "mother_name", label: "Όνομα Μητέρας" },
  { key: "afm", label: "ΑΦΜ" },
  { key: "amka", label: "ΑΜΚΑ" },
  { key: "id_number", label: "Αρ. Ταυτότητας" },
  { key: "phone", label: "Τηλέφωνο" },
  { key: "birth_date", label: "Ημερομηνία Γέννησης", type: "date" },
  { key: "birth_place", label: "Τόπος Γέννησης" },
  { key: "address_street", label: "Οδός" },
  { key: "address_number", label: "Αριθμός" },
  { key: "address_postal", label: "ΤΚ" },
  { key: "address_city", label: "Πόλη" },
  { key: "address_region", label: "Νομός" },
];

function AccountPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const fetchProfile = useServerFn(getMyProfile);
  const updateProfile = useServerFn(updateMyProfile);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loading && !user) nav({ to: "/login" }); }, [loading, user, nav]);
  useEffect(() => {
    if (!user) return;
    fetchProfile().then((p) => {
      const prof = unwrapServerFn(p) as Profile | null;
      setProfile(prof);
      const init: Record<string, string> = {};
      FIELDS.forEach(({ key }) => { init[key] = (prof?.[key] as string | null | undefined) ?? ""; });
      setForm(init);
    }).catch(console.error);
  }, [user, fetchProfile]);

  if (loading || !user) return null;
  const isPremium = profile?.subscription_status === "premium";

  const onSave = async () => {
    setSaving(true);
    try {
      unwrapServerFn(await updateProfile({ data: form }));
      toast.success("Τα στοιχεία αποθηκεύτηκαν.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Λογαριασμός</h1>

        <div className="rounded-2xl border bg-card p-6">
          <div className="text-sm text-muted-foreground">Email</div>
          <div className="font-medium">{user.email}</div>
        </div>

        <div className="rounded-2xl border bg-card p-6">
          <div className="text-sm text-muted-foreground">Συνδρομή</div>
          <div className="mt-1 font-medium flex items-center gap-2">
            {isPremium ? (<><Sparkles className="h-4 w-4 text-gold" />Premium · απεριόριστα</>) : "Δωρεάν"}
          </div>
          {!isPremium && (
            <div className="mt-2 text-sm text-muted-foreground">
              Credits: {profile?.pay_per_use_credits ?? 0} · Δωρεάν δοκιμή: {Math.min(profile?.total_documents_used ?? 0, 1)}/1
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Τα στοιχεία μου</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Συμπλήρωσέ τα μία φορά για να γίνεται γρήγορη συμπλήρωση εγγράφων.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
            {FIELDS.map(({ key, label, type, col }) => (
              <div key={key} className={col ?? ""}>
                <Label htmlFor={key} className="text-xs">{label}</Label>
                <Input
                  id={key}
                  type={type ?? "text"}
                  value={form[key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Αποθήκευση
            </Button>
          </div>
        </div>

        <Button variant="outline" onClick={() => signOut().then(() => nav({ to: "/" }))}>Αποσύνδεση</Button>
      </main>
    </div>
  );
}
