export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}

/** ASP.NET 單一入口：api.ashx?r=/路徑?參數 */
export const apiUrl = (p: string) => `api.ashx?r=${encodeURIComponent(p)}`;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'uqa' };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(apiUrl(path), { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `請求失敗（${res.status}）`, data);
  return data as T;
}
