import type { Platform } from '../platform/detect'
import { getMax } from '../platform/max'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export const apiUrl = (path: string) => {
  const p = path.startsWith('/') ? path : `/${path}`
  return API_BASE_URL ? `${API_BASE_URL}${p}` : p
}

type PlatformLike = Pick<Platform, 'platform'> & Partial<Platform>

export function buildHeaders(platform: PlatformLike | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (platform?.webSessionToken) headers['X-Web-Session'] = platform.webSessionToken
  const initData = getMax()?.initData
  if (platform?.platform === 'max' && initData) headers['X-Max-Init-Data'] = initData
  return headers
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error || `Ошибка запроса (${response.status}).`, response.status)
  }
  return (payload?.data ?? payload) as T
}

export async function apiGet<T>(platform: PlatformLike | null, path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { method: 'GET', cache: 'no-store', headers: buildHeaders(platform) })
  return unwrap<T>(response)
}

export async function apiPost<T>(platform: PlatformLike | null, path: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    cache: 'no-store',
    headers: buildHeaders(platform),
    body: JSON.stringify(body ?? {}),
  })
  return unwrap<T>(response)
}
