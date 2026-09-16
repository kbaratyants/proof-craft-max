/** Токен бота MAX: им подписывается initData мини-приложения и авторизуются вызовы Bot API. */
export const maxBotToken = (): string => (process.env.MAX_BOT_TOKEN || '').trim()

/** Адрес Bot API настраивается для тестов и прокси. */
export const maxApiBaseUrl = (): string =>
  (process.env.MAX_API_BASE_URL || 'https://platform-api2.max.ru').replace(/\/+$/, '')
