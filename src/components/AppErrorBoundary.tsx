import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Παρουσιάστηκε απρόβλεπτο σφάλμα.",
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Κάτι πήγε στραβά</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Η εφαρμογή συνάντησε σφάλμα, αλλά τα δεδομένα σου δεν χάθηκαν.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{this.state.message}</p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              onClick={this.handleReset}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Δοκίμασε ξανά
            </button>
            <a href="/" className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
              Αρχική
            </a>
          </div>
        </div>
      </div>
    );
  }
}