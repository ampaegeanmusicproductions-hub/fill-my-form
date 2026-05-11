export type ServerFnFailure = {
  ok: false;
  error: string;
  details?: {
    code?: string;
    fn?: string;
    step?: string;
    status?: number;
    cause?: string;
  };
};

export type ServerFnSuccess<T> = { ok: true; data: T };
export type ServerFnResponse<T> = ServerFnSuccess<T> | ServerFnFailure;

export function isServerFnFailure<T>(value: ServerFnResponse<T> | T | unknown): value is ServerFnFailure {
  return !!value && typeof value === "object" && "ok" in value && (value as { ok?: boolean }).ok === false;
}

export function unwrapServerFn<T>(value: ServerFnResponse<T> | T): T {
  if (isServerFnFailure<T>(value)) {
    throw new Error(value.error || "Η ενέργεια απέτυχε.");
  }

  if (value && typeof value === "object" && "ok" in (value as Record<string, unknown>) && (value as { ok?: boolean }).ok === true) {
    return (value as ServerFnSuccess<T>).data;
  }

  return value as T;
}