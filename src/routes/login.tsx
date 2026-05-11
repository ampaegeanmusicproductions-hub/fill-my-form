import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/Header";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Σύνδεση — FormFill.gr" }, { name: "description", content: "Σύνδεση στον λογαριασμό σου στο FormFill.gr" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Καλώς ήρθες ξανά!");
    nav({ to: "/dashboard" });
  };

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-3xl font-bold">Σύνδεση</h1>
        <p className="text-muted-foreground mt-2 text-sm">Καλώς ήρθες ξανά.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Κωδικός</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Σύνδεση..." : "Σύνδεση"}</Button>
        </form>
        <p className="text-sm text-muted-foreground mt-6 text-center">Δεν έχεις λογαριασμό; <Link to="/signup" className="text-primary font-medium">Εγγραφή</Link></p>
      </main>
    </div>
  );
}
