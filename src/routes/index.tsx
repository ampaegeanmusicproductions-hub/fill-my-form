import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PdfEditor } from "@/components/PdfEditor";
import { Upload, Sparkles, Download, ShieldCheck, Check } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Autodilosi.gr — Συμπλήρωσε ελληνικά έγγραφα ψηφιακά" },
      { name: "description", content: "Ανέβασε οποιοδήποτε έγγραφο. Η AI εντοπίζει τα πεδία. Συμπλήρωσε και κατέβασε PDF έτοιμο για gov.gr." },
    ],
  }),
  component: Index,
});

const tiers = [
  { name: "Δωρεάν", price: "€0", desc: "Για να δοκιμάσεις.", features: ["1 έγγραφο για πάντα", "Όλα τα formats", "Άμεση εξαγωγή PDF"] },
  { name: "Pay-per-use", price: "€1", suffix: "/έγγραφο", desc: "Πληρώνεις μόνο όταν χρειάζεσαι.", features: ["1 credit ανά πληρωμή", "Χωρίς συνδρομή", "Μένει για πάντα"] },
  { name: "Premium", price: "€4.99", suffix: "/μήνα", desc: "Απεριόριστη χρήση.", featured: true, features: ["Απεριόριστα έγγραφα", "Προτεραιότητα", "Ακύρωση οποτεδήποτε"] },
];

function Index() {
  return (
    <div>
      <Header />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
          <div className="mx-auto max-w-6xl px-4 pt-16 pb-10 sm:pt-24 sm:pb-14 text-center relative">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
              <Sparkles className="h-3.5 w-3.5 text-gold" /> Φτιαγμένο για ελληνική γραφειοκρατία
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-3xl mx-auto">
              Συμπληρώνεις. <span className="text-primary">Υπογράφεις.</span> Έτοιμο.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
              Ανέβασε φωτογραφία ή PDF του εγγράφου σου. Η AI εντοπίζει αυτόματα τα κενά πεδία. Πληκτρολογείς και κατεβάζεις καθαρό PDF — έτοιμο για ψηφιακή υπογραφή στο gov.gr.
            </p>
            <div className="mt-7 flex justify-center gap-3 flex-wrap">
              <a href="#try"><Button size="lg" className="h-12 px-7">Δοκίμασέ το τώρα</Button></a>
              <a href="#pricing"><Button size="lg" variant="outline" className="h-12 px-7">Δες τις τιμές</Button></a>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">Δοκίμασε χωρίς εγγραφή · 1 έγγραφο δωρεάν</div>
          </div>
        </section>

        {/* Try it now — upload tool */}
        <section id="try" className="mx-auto max-w-4xl px-4 pb-16 -mt-2">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-primary font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> Δοκίμασε αμέσως
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold mt-2">Ανέβασε το έγγραφό σου</h2>
            <p className="text-sm text-muted-foreground mt-2">Πάτα οπουδήποτε στο έγγραφο και γράψε. Χωρίς εγγραφή για την πρώτη δοκιμή.</p>
          </div>
          <ClientOnly fallback={<div className="text-center text-muted-foreground py-8">Φόρτωση επεξεργαστή…</div>}>
            <PdfEditor />
          </ClientOnly>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-4 py-16 border-t">
          <h2 className="text-3xl font-bold text-center mb-12">Πώς λειτουργεί</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Upload, title: "1. Ανέβασε", text: "Σύρε ένα PDF ή φωτογράφισε το έγγραφο. Όλα τα formats δεκτά." },
              { icon: Sparkles, title: "2. Συμπλήρωσε", text: "Η AI βρίσκει τα κενά πεδία. Εσύ απλώς πληκτρολογείς." },
              { icon: Download, title: "3. Κατέβασε", text: "Καθαρό PDF, ίδιο με το πρωτότυπο. Έτοιμο για gov.gr." },
            ].map((s) => (
              <div key={s.title} className="rounded-2xl border bg-card p-6">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="font-semibold text-lg">{s.title}</div>
                <p className="text-sm text-muted-foreground mt-2">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section className="mx-auto max-w-6xl px-4 py-6">
          <div className="rounded-2xl bg-primary text-primary-foreground p-8 sm:p-12 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <ShieldCheck className="h-10 w-10 text-gold shrink-0" />
              <div>
                <div className="font-semibold text-lg">Δεν αλλοιώνουμε ποτέ το έγγραφό σου</div>
                <div className="text-sm opacity-90 mt-1">Γράφουμε μόνο πάνω στο πρωτότυπο. Ίδιο logo, ίδια διάταξη, μηδενική παραμόρφωση.</div>
              </div>
            </div>
            <a href="#try"><Button size="lg" variant="secondary">Ξεκίνα τώρα</Button></a>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold text-center">Απλές τιμές</h2>
          <p className="text-center text-muted-foreground mt-3">Διάλεξε ό,τι σου ταιριάζει.</p>
          <div className="grid md:grid-cols-3 gap-6 mt-10">
            {tiers.map((t) => (
              <div key={t.name} className={`rounded-2xl border p-7 bg-card ${t.featured ? "border-primary shadow-lg ring-2 ring-primary/20" : ""}`}>
                {t.featured && <div className="inline-flex items-center gap-1 text-xs rounded-full bg-gold/20 text-gold-foreground px-2 py-1 mb-3"><Sparkles className="h-3 w-3" /> Δημοφιλές</div>}
                <div className="font-semibold text-lg">{t.name}</div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{t.price}</span>
                  {t.suffix && <span className="text-muted-foreground text-sm">{t.suffix}</span>}
                </div>
                <p className="text-sm text-muted-foreground mt-2">{t.desc}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {t.features.map((f) => (<li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />{f}</li>))}
                </ul>
                <Link to="/signup" className="block mt-6"><Button className="w-full" variant={t.featured ? "default" : "outline"}>Ξεκίνα</Button></Link>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-16 border-t">
          <h2 className="text-3xl font-bold text-center mb-10">Συχνές ερωτήσεις</h2>
          <div className="space-y-4">
            {[
              ["Ποια αρχεία υποστηρίζονται;", "PDF, JPG, PNG, WebP, HEIC από iPhone. Σύντομα και Word."],
              ["Πόσο κοστίζει;", "1 έγγραφο δωρεάν για δοκιμή. Μετά €1 ανά έγγραφο ή €4.99/μήνα για απεριόριστα."],
              ["Είναι ασφαλές;", "Τα αρχεία αποθηκεύονται ιδιωτικά στον λογαριασμό σου. Μόνο εσύ έχεις πρόσβαση."],
              ["Δουλεύει με gov.gr;", "Ναι. Το PDF είναι έτοιμο για ανέβασμα και ψηφιακή υπογραφή."],
            ].map(([q, a]) => (
              <details key={q} className="rounded-xl border bg-card p-5">
                <summary className="font-semibold cursor-pointer">{q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
