import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PdfEditor } from "@/components/PdfEditor";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Autodilosi.gr — Συμπλήρωσε οποιοδήποτε έγγραφο σε δευτερόλεπτα" },
      { name: "description", content: "Ανέβασε. Γράψε. Κατέβασε PDF έτοιμο για gov.gr." },
    ],
  }),
  component: Index,
});

const tiers = [
  { name: "Δωρεάν", price: "€0", desc: "Δοκίμασέ το.", features: ["1 έγγραφο", "Όλα τα formats", "Άμεση εξαγωγή PDF"] },
  { name: "Pro", price: "€4.99", suffix: "/μήνα", desc: "Για συχνή χρήση.", featured: true, features: ["Απεριόριστα έγγραφα", "Προτεραιότητα", "Ακύρωση οποτεδήποτε"] },
  { name: "Business", price: "€9.99", suffix: "/μήνα", desc: "Για ομάδες.", features: ["Όλα του Pro", "Πολλαπλοί χρήστες", "Email υποστήριξη"] },
];

function Index() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero + Upload — single viewport */}
        <section className="mx-auto max-w-3xl px-4 pt-8 pb-10 sm:pt-12">
          <div className="text-center mb-6">
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
              Συμπλήρωσε οποιοδήποτε έγγραφο σε <span className="text-primary">δευτερόλεπτα</span>
            </h1>
            <p className="mt-3 text-base sm:text-lg text-muted-foreground">
              Ανέβασε. Γράψε. Κατέβασε PDF έτοιμο για gov.gr.
            </p>
          </div>

          <ClientOnly fallback={<div className="text-center text-muted-foreground py-8">Φόρτωση…</div>}>
            <PdfEditor />
          </ClientOnly>

          <div className="mt-3 text-center text-xs text-muted-foreground">
            1 δωρεάν έγγραφο · Χωρίς εγγραφή για δοκιμή
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-5xl px-4 py-12 border-t">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8">Τιμές</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={`rounded-2xl border p-6 bg-card ${t.featured ? "border-primary shadow ring-1 ring-primary/20" : ""}`}
              >
                {t.featured && (
                  <div className="inline-flex items-center gap-1 text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5 mb-2">
                    <Sparkles className="h-3 w-3" /> Δημοφιλές
                  </div>
                )}
                <div className="font-semibold">{t.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{t.price}</span>
                  {t.suffix && <span className="text-muted-foreground text-sm">{t.suffix}</span>}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className="block mt-5">
                  <Button className="w-full" variant={t.featured ? "default" : "outline"}>Ξεκίνα</Button>
                </Link>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
