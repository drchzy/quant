export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(
  path: string,
  body: unknown = {}
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function apiPut<T>(
  path: string,
  body: unknown = {}
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export function formatMoney(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  if (Math.abs(number) >= 1e8) {
    return `${(number / 1e8).toFixed(2)}亿`;
  }
  if (Math.abs(number) >= 1e4) {
    return `${(number / 1e4).toFixed(2)}万`;
  }
  return number.toFixed(0);
}

export function formatPct(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}
