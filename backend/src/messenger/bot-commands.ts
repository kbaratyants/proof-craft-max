import { demoEnabled } from '../demo/demo.constants.js'

export type BotCommand = { name: string; description: string }

/** Меню команд бота (подсказки по `/`). MAX показывает один список всем — доступ проверяет каждая команда. */
export const botCommands = (): BotCommand[] => [
  { name: 'start', description: 'Приветствие и вход в дневник' },
  { name: 'app', description: 'Открыть дневник академии' },
  { name: 'me', description: 'Ученику: мои работы, оценки и отзывы' },
  { name: 'teacher', description: 'Преподавателю: работы на проверке' },
  { name: 'stats', description: 'Администратору: сводка академии' },
  { name: 'admin', description: 'Администратору: заявки и преподаватели' },
  { name: 'id', description: 'Мой ID в MAX' },
  ...(demoEnabled() ? [{ name: 'demo', description: 'Демо-академия для жюри' }] : []),
  { name: 'help', description: 'Что умеет бот' },
]
