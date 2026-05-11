import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useAuth, signOut } from "@/lib/use-auth";
import { getMyProfile } from "@/lib/quota.functions";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Λογαριασμός — FormFill.gr" }, { name: "description", content: "Διαχείριση λογαριασμού και συνδρομής." }] }),
  component: AccountPage,
});

function AccountPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const fetchProfile = useServerFn(getMyProfile);
  type Profile = { subscription_status: string; pay_per_use_credits: number; total_documents_used: number };
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => { if (!loading && !user) nav({ to: "/login" }); }, [loading, user, nav]);
  useEffect(() => { if (user) fetchProfile().then((p) => setProfile(p as Profile | null)).catch(console.error); }, [user, fetchProfile]);

  if (loading || !user) return null;
  const isPremium = profile?.subscription_status === "premium";

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-12 space-y-6">
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

        <Button variant="outline" onClick={() => signOut().then(() => nav({ to: "/" }))}>Αποσύνδεση</Button>
      </main>
    </div>
  );
}
