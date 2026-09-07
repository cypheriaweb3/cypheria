import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BICUBIC, createICNS, createICO } from "png2icons"
import sharp from "sharp"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const markPath = join(desktopRoot, "renderer/src/assets/brand/cypheria-mark.svg")
const appIconSvgPath = join(desktopRoot, "renderer/src/assets/brand/cypheria-app-icon.svg")
const outputDir = join(desktopRoot, "resources/icons")

const mark = await readFile(markPath, "utf8")
const paths = [...mark.matchAll(/<path fill="#000" d="([^"]+)"\/>/g)].map(([, path]) => path)

if (paths.length !== 2 || !paths[0] || !paths[1]) {
  throw new Error("Cypheria mark must contain exactly two black paths")
}

const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" role="img" aria-labelledby="title description">
  <title id="title">Cypheria</title>
  <desc id="description">Cypheria application icon</desc>
  <rect width="1254" height="1254" rx="276" fill="#121117"/>
  <path fill="#F7F7F8" d="${paths[0]}"/>
  <path fill="#8B72FF" d="${paths[1]}"/>
</svg>
`

await mkdir(outputDir, { recursive: true })
await writeFile(appIconSvgPath, appIconSvg)

const platformIconSize = 1024
const platformArtworkSize = 860
const platformArtwork = await sharp(Buffer.from(appIconSvg))
  .resize(platformArtworkSize, platformArtworkSize)
  .png({ compressionLevel: 9 })
  .toBuffer()
const png1024 = await sharp({
  create: {
    background: { alpha: 0, b: 0, g: 0, r: 0 },
    channels: 4,
    height: platformIconSize,
    width: platformIconSize,
  },
})
  .composite([
    {
      input: platformArtwork,
      left: (platformIconSize - platformArtworkSize) / 2,
      top: (platformIconSize - platformArtworkSize) / 2,
    },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer()

await writeFile(join(outputDir, "icon.svg"), appIconSvg)
await writeFile(join(outputDir, "icon.png"), png1024)

for (const size of [16, 32, 64, 128, 256, 512]) {
  const png = await sharp(png1024).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(join(outputDir, `icon-${size}.png`), png)
}

const icns = createICNS(png1024, BICUBIC, 0)
const ico = createICO(png1024, BICUBIC, 0, true, true)

if (!icns || !ico) {
  throw new Error("Could not create platform application icons")
}

await writeFile(join(outputDir, "icon.icns"), icns)
await writeFile(join(outputDir, "icon.ico"), ico)
