import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [{ title: "Τιμές — FormFill.gr" }, { name: "description", content: "Δωρεάν δοκιμή, €1 ανά έγγραφο ή €4.99/μήνα για απεριόριστα." }] }),
  component: Pricing,
});

const tiers = [
  { name: "Δωρεάν", price: "€0", desc: "Για να δοκιμάσεις.", features: ["1 έγγραφο για πάντα", "Όλα τα formats", "Άμεση εξαγωγή PDF"] },
  { name: "Pay-per-use", price: "€1", suffix: "/έγγραφο", desc: "Πληρώνεις μόνο όταν χρειάζεσαι.", features: ["1 credit ανά πληρωμή", "Χωρίς συνδρομή", "Μένει για πάντα στον λογαριασμό σου"] },
  { name: "Premium", price: "€4.99", suffix: "/μήνα", desc: "Απεριόριστη χρήση.", featured: true, features: ["Απεριόριστα έγγραφα", "Προτεραιότητα στην επεξεργασία", "Ακύρωση οποτεδήποτε"] },
];

function Pricing() {
  return (
    <div>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-4xl font-bold text-center">Απλές τιμές</h1>
        <p className="text-center text-muted-foreground mt-3">Διάλεξε ό,τι σου ταιριάζει.</p>
        <div className="grid md:grid-cols-3 gap-6 mt-12">
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
        <p className="text-xs text-muted-foreground text-center mt-8">Οι πληρωμές προστίθενται σύντομα μέσω Stripe. Στη δοκιμαστική φάση τα κουμπιά αγοράς λειτουργούν ως προσομοίωση.</p>
      </main>
      <Footer />
    </div>
  );
}
