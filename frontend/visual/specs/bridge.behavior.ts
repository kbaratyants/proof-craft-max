import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'

type BridgeCall = [string, ...unknown[]]

/** Подмена `window.WebApp` внутри MAX: методы Bridge только записывают вызовы. */
const mockMaxBridge = (page: Page) =>
  page.addInitScript(() => {
    const calls: unknown[][] = []
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args])
      }
    Object.assign(window, {
      __bridgeCalls: calls,
      WebApp: {
        initData: 'query_id=visual&user=%7B%22id%22%3A777%7D&hash=visual',
        initDataUnsafe: { user: { id: 777 } },
        ready: () => {},
        HapticFeedback: {
          impactOccurred: record('impactOccurred'),
          notificationOccurred: record('notificationOccurred'),
          selectionChanged: record('selectionChanged'),
        },
        enableClosingConfirmation: record('enableClosingConfirmation'),
        disableClosingConfirmation: record('disableClosingConfirmation'),
        shareMaxContent: record('shareMaxContent'),
        downloadFile: record('downloadFile'),
      },
    })
  })

const bridgeCalls = (page: Page) => page.evaluate(() => (window as unknown as { __bridgeCalls: BridgeCall[] }).__bridgeCalls)

/** Обычный браузер: вибрация и буфер обмена записываются, системного меню «Поделиться» нет. */
const mockBrowserApis = (page: Page) =>
  page.addInitScript(() => {
    const vibrations: unknown[] = []
    const clipboard: string[] = []
    Object.assign(window, { __vibrations: vibrations, __clipboard: clipboard })
    Object.defineProperty(navigator, 'vibrate', { value: (pattern: unknown) => vibrations.push(pattern) > 0 })
    Object.defineProperty(navigator, 'share', { value: undefined })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => void clipboard.push(text) } })
  })

const openAnnaPortfolio = async (page: Page) => {
  await page.locator('article.card', { hasText: 'Анна Смирнова' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Анна Смирнова' })).toBeVisible()
}

test.describe('MAX Bridge', () => {
  test('поделиться портфолио и работой через чат MAX', async ({ openAs, settle, page }) => {
    await mockMaxBridge(page)
    await openAs(null, '?guest=1')
    await openAnnaPortfolio(page)
    await page.getByRole('button', { name: 'Поделиться' }).click()
    await page.getByRole('button', { name: /^Фейд/ }).click()
    await settle()
    await page.getByRole('button', { name: 'Поделиться' }).click()

    const shares = (await bridgeCalls(page)).filter(([name]) => name === 'shareMaxContent')
    expect(shares).toHaveLength(2)
    const [portfolio, work] = shares.map(([, params]) => params as { text: string; link: string })
    expect(portfolio.text).toBe('Портфолио ученика MADCAP Academy: Анна Смирнова')
    expect(portfolio.link).toMatch(/\/\?guest=1&student=\d+$/)
    expect(work.text).toBe('Работа ученика MADCAP Academy: Фейд')
    expect(work.link).toMatch(new RegExp(`^${portfolio.link.replace(/[.?]/g, '\\$&')}&hw=\\d+$`))
  })

  test('ссылка «Поделиться» открывает работу, «Назад» ведёт в портфолио и витрину', async ({ openAs, settle, page }) => {
    await mockMaxBridge(page)
    await openAs(null, '?guest=1')
    await openAnnaPortfolio(page)
    await page.getByRole('button', { name: /^Фейд/ }).click()
    await settle()
    await page.getByRole('button', { name: 'Поделиться' }).click()
    const [[, params]] = (await bridgeCalls(page)).filter(([name]) => name === 'shareMaxContent')
    const link = new URL((params as { link: string }).link)

    await page.goto(`/${link.search}`)
    await settle()
    await expect(page.locator('.hdr h2')).toHaveText('Работа')
    await expect(page.getByText('Фейд', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Анна Смирнова' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('heading', { name: /Работы наших/ })).toBeVisible()
  })

  test('фото из витрины скачивается средствами MAX по прямой ссылке', async ({ openAs, settle, page }) => {
    await mockMaxBridge(page)
    await openAs(null, '?guest=1')
    await openAnnaPortfolio(page)
    await page.getByRole('button', { name: /^Фейд/ }).click()
    await settle()
    await page.getByAltText('Фото 1').click()
    await page.getByRole('button', { name: 'Скачать' }).click()
    const downloads = (await bridgeCalls(page)).filter(([name]) => name === 'downloadFile')
    expect(downloads).toHaveLength(1)
    const [, url, fileName] = downloads[0]
    expect(new URL(String(url)).pathname).toMatch(/^\/api\/guest\/homeworks\/\d+\/(attachments\/\d+\/)?file$/)
    expect(fileName).toMatch(/^madcap-hw[\d-]+\.jpg$/)
  })

  test('в браузере: вибрация на вкладках и событиях, ссылка копируется', async ({ openAs, settle, page }) => {
    await mockBrowserApis(page)
    await openAs('student')
    await page.locator('.tb', { hasText: 'Профиль' }).click()
    await settle()
    expect(await page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations)).toEqual([8])

    await page.getByRole('button', { name: 'Поделиться портфолио' }).click()
    await expect(page.locator('.toast')).toHaveText('Ссылка скопирована')
    const clipboard = await page.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard)
    expect(clipboard).toHaveLength(1)
    expect(clipboard[0]).toMatch(/^Моё портфолио в MADCAP Academy — Анна Смирнова http.*\/\?guest=1&student=\d+$/)
    // Успешное действие — вибрация «успех».
    expect(await page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations)).toEqual([8, [15, 60, 25]])
  })

  test('новое событие в реальном времени — вибрация, первая загрузка — без неё', async ({ openAs, settle, page }) => {
    await mockMaxBridge(page)
    let unread = 0
    await page.route('**/api/chats/students?*', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      const threads = body.data?.students ?? body.students
      if (threads?.[0]) threads[0].unread_count = unread
      await route.fulfill({ response, json: body })
    })
    await page.addInitScript(() => localStorage.setItem('ba_demo', '1'))
    await openAs('student')
    const notifications = async () =>
      (await bridgeCalls(page)).filter(([name]) => name === 'notificationOccurred').map(([, kind]) => kind)
    expect(await notifications()).toEqual([])

    // Счётчики перезапрашиваются после действий (в демо — после симулятора); здесь — после открытия чата.
    unread = 2
    await page.locator('.tb', { hasText: 'Чат' }).click()
    await expect(page.locator('.tb', { hasText: 'Чат' }).locator('.dot')).toHaveText('2')
    await settle()
    expect(await notifications()).toEqual(['warning'])
  })

  test('в браузере: несохранённое сообщение в чате защищено от закрытия вкладки', async ({ openAs, settle, page }) => {
    await openAs('student')
    await page.locator('.tb', { hasText: 'Чат' }).click()
    await settle()
    const closingBlocked = () =>
      page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))
    expect(await closingBlocked()).toBe(false)
    await page.getByRole('textbox').last().fill('Черновик')
    expect(await closingBlocked()).toBe(true)
    await page.getByRole('textbox').last().fill('')
    expect(await closingBlocked()).toBe(false)
  })
})
