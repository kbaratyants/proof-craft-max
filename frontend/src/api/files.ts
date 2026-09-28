import { useApp } from '../app/store'
import { canDownloadInMax, downloadInMax } from '../platform/bridge'
import { apiPost, apiUrl, buildHeaders } from './client'

const enc = encodeURIComponent

export const guestHomeworkFileUrl = (homeworkId: number, preview = false) =>
  apiUrl(`/api/guest/homeworks/${enc(homeworkId)}/file${preview ? '?preview=1' : ''}`)

export const guestHomeworkAttachmentFileUrl = (homeworkId: number, attachmentId: number, preview = false) =>
  apiUrl(`/api/guest/homeworks/${enc(homeworkId)}/attachments/${enc(attachmentId)}/file${preview ? '?preview=1' : ''}`)

export const guestStudentAvatarUrl = (studentId: number) => apiUrl(`/api/guest/students/${enc(studentId)}/avatar`)

/** Скачивает файл с заголовками авторизации и открывает его во вкладке. */
export async function openFile(url: string, onError: (message: string) => void) {
  try {
    const response = await fetch(url, { headers: buildHeaders(useApp.getState().platform) })
    if (!response.ok) {
      onError('Не удалось открыть файл')
      return
    }
    const blobUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = blobUrl
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  } catch {
    onError('Не удалось открыть файл')
  }
}

/** Имя файла для сохранения: `madcap-hw12-5.jpg` из `/api/homeworks/12/attachments/5/file`. */
export const downloadName = (url: string) => {
  const ids = new URL(url, window.location.origin).pathname.match(/\d+/g) ?? []
  return `madcap-hw${ids.join('-') || 'file'}.jpg`
}

/**
 * Скачивание фото. В MAX файл забирает сам клиент без наших заголовков, поэтому для закрытых файлов
 * API выдаёт короткоживущую подписанную ссылку; публичные файлы витрины скачиваются по прямой ссылке.
 * В браузере — обычное сохранение через `<a download>`.
 */
export async function downloadFile(url: string, fileName: string, onError: (message: string) => void) {
  const { platform, appUserId } = useApp.getState()
  try {
    if (canDownloadInMax()) {
      const absolute = new URL(url, window.location.origin)
      let target = absolute.href
      if (!absolute.pathname.startsWith('/api/guest/')) {
        const link = await apiPost<{ url: string }>(platform, '/api/downloads/link', {
          max_user_id: appUserId,
          path: absolute.pathname,
        })
        target = new URL(apiUrl(link.url), window.location.origin).href
      }
      downloadInMax(target, fileName)
      return
    }
    const response = await fetch(url, { headers: buildHeaders(platform) })
    if (!response.ok) {
      onError('Не удалось скачать файл')
      return
    }
    const blobUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  } catch {
    onError('Не удалось скачать файл')
  }
}

const withUser = (preview = false) => {
  const q = new URLSearchParams({ max_user_id: String(useApp.getState().appUserId) })
  if (preview) q.set('preview', '1')
  return q.toString()
}

export const homeworkFileUrl = (homeworkId: number, preview = false) =>
  apiUrl(`/api/homeworks/${enc(homeworkId)}/file?${withUser(preview)}`)

export const homeworkRevisionFileUrl = (homeworkId: number, preview = false) =>
  apiUrl(`/api/homeworks/${enc(homeworkId)}/revision/file?${withUser(preview)}`)

export const homeworkAttachmentFileUrl = (homeworkId: number, attachmentId: number, preview = false) =>
  apiUrl(`/api/homeworks/${enc(homeworkId)}/attachments/${enc(attachmentId)}/file?${withUser(preview)}`)

export const ownAvatarUrl = () => apiUrl(`/api/student/me/avatar?${withUser()}`)

export const studentAvatarUrl = (studentId: number) => apiUrl(`/api/students/${enc(studentId)}/avatar?${withUser()}`)

export const chatFileUrl = (messageId: number) => apiUrl(`/api/chats/messages/${enc(messageId)}/file?${withUser()}`)

/** Заголовки для multipart: браузер сам выставит Content-Type с boundary. */
export const multipartHeaders = () => {
  const headers = buildHeaders(useApp.getState().platform)
  delete headers['Content-Type']
  return headers
}
