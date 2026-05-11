import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/Header";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Εγγραφή — FormFill.gr" }, { name: "description", content: "Δημιούργησε δωρεάν λογαριασμό στο FormFill.gr" }] }),
  component: SignupPage,
});

function SignupPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Λογαριασμός δημιουργήθηκε!");
    nav({ to: "/dashboard" });
  };

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-3xl font-bold">Εγγραφή</h1>
        <p className="text-muted-foreground mt-2 text-sm">1 έγγραφο δωρεάν για να δοκιμάσεις. Χωρίς πιστωτική.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-2"><Label>Όνομα</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Γιάννης Παπαδόπουλος" /></div>
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Κωδικός</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Δημιουργία..." : "Δημιουργία λογαριασμού"}</Button>
        </form>
        <p className="text-sm text-muted-foreground mt-6 text-center">Έχεις ήδη λογαριασμό; <Link to="/login" className="text-primary font-medium">Σύνδεση</Link></p>
      </main>
    </div>
  );
}
