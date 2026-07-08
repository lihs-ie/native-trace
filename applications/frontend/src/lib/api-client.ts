/**
 * 共有 API クライアント
 * /api/v1/** への fetch をラップし、envelope ({ data, meta } / { error }) を処理する。
 * process.env / class 構文 / domain import は使わない。
 */

export type ApiClientError = Error & {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
};

function createApiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiClientError {
  const error = new Error(message) as ApiClientError;
  error.name = "ApiError";
  (error as { status: number }).status = status;
  (error as { code: string }).code = code;
  if (details !== undefined) {
    (error as { details: unknown }).details = details;
  }
  return error;
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof Error && error.name === "ApiError";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    const errorEnvelope = json as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    const errorPayload = errorEnvelope?.error;
    throw createApiError(
      response.status,
      errorPayload?.code ?? "UNKNOWN",
      errorPayload?.message ?? `HTTP ${response.status}`,
      errorPayload?.details,
    );
  }

  const envelope = json as { data: T };
  return envelope.data;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  return parseResponse<T>(response);
}

export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    body: formData,
  });
  return parseResponse<T>(response);
}
