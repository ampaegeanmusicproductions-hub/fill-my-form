import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/use-auth";
import { getMyProfile, listMyDocuments, getSignedDocumentUrl } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { FileText, Plus, Sparkles, Search, Download, FileInput } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Πίνακας — FormFill.gr" }, { name: "description", content: "Τα έγγραφά σου και η χρήση σου." }] }),
  component: Dashboard,
});

type Profile = { subscription_status: string; pay_per_use_credits: number; total_documents_used: number };
type Doc = {
  id: string;
  name: string;
  created_at: string;
  filled_file_path: string | null;
  original_file_path: string | null;
};

function Dashboard() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const fetchProfile = useServerFn(getMyProfile);
  const fetchDocs = useServerFn(listMyDocuments);
  const fetchSigned = useServerFn(getSignedDocumentUrl);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => { if (!loading && !user) nav({ to: "/login" }); }, [loading, user, nav]);
  useEffect(() => {
    if (!user) return;
    fetchProfile().then((p) => setProfile(unwrapServerFn(p) as Profile | null)).catch(console.error);
    fetchDocs().then((d) => setDocs(unwrapServerFn(d) as Doc[])).catch(console.error);
  }, [user, fetchProfile, fetchDocs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.name.toLowerCase().includes(q));
  }, [docs, query]);

  if (loading || !user) return null;

  const isPremium = profile?.subscription_status === "premium";
  const credits = profile?.pay_per_use_credits ?? 0;
  const used = profile?.total_documents_used ?? 0;

  const open = async (bucket: "originals" | "filled", path: string | null) => {
    if (!path) {
      toast.error("Δεν υπάρχει διαθέσιμο αρχείο");
      return;
    }
    try {
      const res = await fetchSigned({ data: { bucket, path } });
      const out = unwrapServerFn(res) as { url: string };
      window.open(out.url, "_blank");
    } catch (e) {
      toast.error("Αποτυχία ανοίγματος", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">Τα έγγραφά μου</h1>
            <div className="mt-2 text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
              {isPremium ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 text-gold-foreground px-3 py-1"><Sparkles className="h-3 w-3" /> Premium · απεριόριστα</span>
              ) : (
                <>
                  <span>Δωρεάν δοκιμή: {Math.min(used, 1)}/1</span>
                  <span>·</span>
                  <span>Credits: {credits}</span>
                </>
              )}
            </div>
          </div>
          <Link to="/editor"><Button size="lg"><Plus className="h-4 w-4" />Νέο Έγγραφο</Button></Link>
        </div>

        <div className="mt-8 relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Αναζήτηση εγγράφου…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="mt-6">
          {docs.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed bg-card p-16 text-center">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
              <div className="mt-3 font-semibold">Δεν έχεις έγγραφα ακόμη</div>
              <p className="text-sm text-muted-foreground mt-1">Ξεκίνα ανεβάζοντας το πρώτο σου.</p>
              <Link to="/editor"><Button className="mt-5">Νέο Έγγραφο</Button></Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              Δεν βρέθηκαν έγγραφα για «{query}»
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((d) => (
                <div key={d.id} className="rounded-xl border bg-card p-5 flex flex-col">
                  <FileText className="h-6 w-6 text-primary" />
                  <div className="font-semibold mt-3 truncate" title={d.name}>{d.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(d.created_at).toLocaleString("el-GR")}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => open("originals", d.original_file_path)}
                      disabled={!d.original_file_path}
                    >
                      <FileInput className="h-3 w-3 mr-1" /> Αρχικό
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => open("filled", d.filled_file_path)}
                      disabled={!d.filled_file_path}
                    >
                      <Download className="h-3 w-3 mr-1" /> PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
