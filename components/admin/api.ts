/** Admin fetch helper: JSON in/out, with a global 401 -> login signal. */
export async function adminFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });

    if (response.status === 401) {
      window.dispatchEvent(new Event("admin-unauthorized"));
      return { ok: false, error: "Session expired." };
    }

    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      return { ok: false, error: (data as { error?: string }).error ?? "Request failed." };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
