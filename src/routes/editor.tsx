import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/use-auth";
import { PdfEditor } from "@/components/PdfEditor";

export const Route = createFileRoute("/editor")({
  head: () => ({ meta: [{ title: "Νέο Έγγραφο — FormFill.gr" }, { name: "description", content: "Ανέβασε και συμπλήρωσε ένα έγγραφο." }] }),
  component: EditorPage,
});

function EditorPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!loading && !user) nav({ to: "/login" }); }, [loading, user, nav]);
  if (loading || !user) return null;

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold mb-2">Νέο Έγγραφο</h1>
        <p className="text-muted-foreground text-sm mb-8">Σύρε ένα αρχείο ή πάτα για επιλογή.</p>
        <ClientOnly fallback={<div className="text-muted-foreground">Φόρτωση επεξεργαστή…</div>}>
          <PdfEditor />
        </ClientOnly>
      </main>
    </div>
  );
}
