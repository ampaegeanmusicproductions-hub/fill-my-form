import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Η σελίδα δεν βρέθηκε</h2>
        <p className="mt-2 text-sm text-muted-foreground">Η σελίδα δεν υπάρχει ή έχει μετακινηθεί.</p>
        <Link to="/" className="inline-flex mt-6 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Αρχική</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Κάτι πήγε στραβά</h1>
        <p className="mt-2 text-sm text-muted-foreground">Δοκίμασε να ανανεώσεις ή γύρνα στην αρχική.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">Δοκίμασε ξανά</button>
          <a href="/" className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Αρχική</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FormFill.gr — Συμπλήρωσε ελληνικά έγγραφα ψηφιακά" },
      { name: "description", content: "Ανέβασε υπεύθυνη δήλωση ή αίτηση και η AI εντοπίζει τα πεδία. Συμπλήρωσε ψηφιακά και κατέβασε καθαρό PDF για gov.gr." },
      { property: "og:title", content: "FormFill.gr" },
      { property: "og:description", content: "Συμπλήρωσε ελληνικά επίσημα έγγραφα ψηφιακά." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <Outlet />
        <Toaster position="top-center" richColors closeButton />
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}
