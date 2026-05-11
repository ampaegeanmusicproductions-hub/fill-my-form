export type ServerFnErrorDetails = {
  code: string;
  fn: string;
  step?: string;
  status?: number;
  cause?: string;
};

export type ServerFnResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details: ServerFnErrorDetails };

export function logServerFnStep(fn: string, step: string, meta?: unknown) {
  if (typeof meta === "undefined") {
    console.log(`[serverFn:${fn}] ${step}`);
    return;
  }

  console.log(`[serverFn:${fn}] ${step}`, meta);
}

export function buildServerFnError<T>(
  fn: string,
  error: unknown,
  options?: { step?: string; defaultMessage?: string; defaultCode?: string },
): ServerFnResult<T> {
  const step = options?.step;
  const fallbackMessage = options?.defaultMessage ?? "Η ενέργεια δεν ολοκληρώθηκε.";
  const fallbackCode = options?.defaultCode ?? "SERVER_FN_ERROR";

  let code = fallbackCode;
  let status: number | undefined;
  let cause = "Άγνωστο σφάλμα";

  if (error instanceof Response) {
    status = error.status;
    cause = `HTTP ${error.status}${error.statusText ? ` ${error.statusText}` : ""}`;
    if (error.status === 401 || error.status === 403) {
      code = "AUTH_REQUIRED";
    }
  } else if (error instanceof Error) {
    cause = error.message;
    if (error.message.includes("QUOTA_EXCEEDED")) {
      code = "QUOTA_EXCEEDED";
    } else if (error.message.toLowerCase().includes("unauthorized")) {
      code = "AUTH_REQUIRED";
    } else if (error.message.toLowerCase().includes("validation")) {
      code = "VALIDATION_ERROR";
    }
  } else if (typeof error === "string") {
    cause = error;
    if (error.includes("QUOTA_EXCEEDED")) {
      code = "QUOTA_EXCEEDED";
    }
  } else if (error != null) {
    cause = JSON.stringify(error);
  }

  const publicMessage =
    code === "AUTH_REQUIRED"
      ? "Απαιτείται σύνδεση για αυτή την ενέργεια."
      : code === "QUOTA_EXCEEDED"
        ? "Έχεις φτάσει το διαθέσιμο όριο χρήσης."
        : fallbackMessage;

  console.error(`[serverFn:${fn}] failed${step ? ` at ${step}` : ""}`, error);

  return {
    ok: false,
    error: publicMessage,
    details: {
      code,
      fn,
      step,
      status,
      cause,
    },
  };
}