import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import sharp from 'sharp'

/** backend/assets/demo — рядом и с src/, и с dist/ (в образе — /app/assets/demo). */
const assetsDir = fileURLToPath(new URL('../../assets/demo', import.meta.url))

let pool: Buffer[] | null = null
const workPool = (): Buffer[] => {
  pool ??= readdirSync(assetsDir)
    .filter((name) => name.startsWith('work-') && name.endsWith('.jpg'))
    .sort()
    .map((name) => readFileSync(join(assetsDir, name)))
  return pool
}

export const demoPortrait = (kind: 'student' | 'teacher'): Buffer => readFileSync(join(assetsDir, `portrait-${kind}.jpg`))

/**
 * Новое «фото работы»: случайный исходник, кадрирование, отражение и лёгкий сдвиг тона,
 * чтобы сгенерированные работы не выглядели одинаково.
 */
export const demoWorkPhoto = async (): Promise<Buffer> => {
  const images = workPool()
  const source = images[Math.floor(Math.random() * images.length)]!
  const image = sharp(source)
  const { width = 900, height = 1350 } = await image.metadata()
  const scale = 0.78 + Math.random() * 0.22
  const cropWidth = Math.round(width * scale)
  const cropHeight = Math.round(height * scale)
  let pipeline = sharp(source).extract({
    left: Math.floor(Math.random() * (width - cropWidth + 1)),
    top: Math.floor(Math.random() * (height - cropHeight + 1)),
    width: cropWidth,
    height: cropHeight,
  })
  if (Math.random() < 0.5) pipeline = pipeline.flop()
  return await pipeline
    .modulate({ brightness: 0.92 + Math.random() * 0.16, saturation: 0.85 + Math.random() * 0.3, hue: Math.round(Math.random() * 16 - 8) })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}
