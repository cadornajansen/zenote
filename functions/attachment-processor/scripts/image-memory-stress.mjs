import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

import { validateBytes } from "../dist/processor.js"

const MAX_IMAGE_BYTES = 3_500_000
const scriptPath = fileURLToPath(import.meta.url)

function memorySample() {
  const { rss, heapUsed, external } = process.memoryUsage()
  return { rss, heapUsed, external }
}

function maximum(current, sample) {
  return {
    rss: Math.max(current.rss, sample.rss),
    heapUsed: Math.max(current.heapUsed, sample.heapUsed),
    external: Math.max(current.external, sample.external),
  }
}

async function validateCase(path, fileName, width, height) {
  const bytes = await readFile(path)
  globalThis.gc?.()
  const before = memorySample()
  let peak = before
  const sampler = setInterval(() => {
    peak = maximum(peak, memorySample())
  }, 1)
  const started = performance.now()
  let status = "success"
  let errorCode
  try {
    await validateBytes(fileName, bytes)
  } catch (error) {
    status = "failure"
    errorCode = error?.code || "unknown"
  } finally {
    clearInterval(sampler)
    peak = maximum(peak, memorySample())
  }
  const after = memorySample()
  process.stdout.write(
    `${JSON.stringify({
      name: fileName,
      width,
      height,
      compressedBytes: bytes.length,
      theoreticalRgbaBytes: width * height * 4,
      path: "sharp.metadata",
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        sharp: sharp.versions.sharp,
        libvips: sharp.versions.vips,
      },
      status,
      ...(errorCode ? { errorCode } : {}),
      durationMs: Number((performance.now() - started).toFixed(2)),
      before,
      peak,
      after,
      peakDelta: {
        rss: peak.rss - before.rss,
        heapUsed: peak.heapUsed - before.heapUsed,
        external: peak.external - before.external,
      },
    })}\n`
  )
}

function runChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let errors = ""
    child.stdout.setEncoding("utf8").on("data", (value) => (output += value))
    child.stderr.setEncoding("utf8").on("data", (value) => (errors += value))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(errors || `stress child exited ${code}`))
      else resolve(JSON.parse(output.trim()))
    })
  })
}

if (process.argv[2] === "--validate") {
  await validateCase(
    process.argv[3],
    process.argv[4],
    Number(process.argv[5]),
    Number(process.argv[6])
  )
} else {
  const directory = await mkdtemp(join(tmpdir(), "zenote-image-stress-"))
  const cases = [
    {
      name: "max-compressed.png",
      width: 8000,
      height: 8000,
      encode: (pipeline) => pipeline.png({ compressionLevel: 9 }),
    },
    {
      name: "near-max.png",
      width: 7800,
      height: 7800,
      encode: (pipeline) => pipeline.png({ compressionLevel: 9 }),
    },
    {
      name: "max-compressed.jpg",
      width: 8000,
      height: 8000,
      encode: (pipeline) => pipeline.jpeg({ quality: 30, chromaSubsampling: "4:2:0" }),
    },
  ]
  const results = []
  try {
    for (const fixture of cases) {
      const path = join(directory, fixture.name)
      const pipeline = sharp({
        create: {
          width: fixture.width,
          height: fixture.height,
          channels: 3,
          background: { r: 32, g: 32, b: 32 },
        },
      })
      await fixture.encode(pipeline).toFile(path)
      const { size } = await stat(path)
      if (size > MAX_IMAGE_BYTES)
        throw new Error(`${fixture.name} exceeds the policy byte limit`)
      results.push(
        await runChild([
          "--validate",
          path,
          fixture.name,
          String(fixture.width),
          String(fixture.height),
        ])
      )
    }
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
