/**
 * Voice transcription: turn any QQ voice payload (amr / silk / mp3 / ogg / …) into
 * the canonical 16 kHz mono PCM16 WAV that the Host `speechToText` recognizer
 * accepts, then hand it to that recognizer.
 *
 * Why transcode: QQ delivers voice in whatever format the gateway picked (often
 * MP3 or SILK renamed `.amr`), while every speech provider behind
 * `ctx.speechToText` only accepts a strict 16 kHz mono PCM16 WAV. This module is
 * the bridge.
 *
 * The plugin itself stays dependency-free: `ffmpeg` is resolved at call time, in
 * this order —
 *   1. the `ffmpegPath` setting,
 *   2. `$ONEBOT_MINI_FFMPEG`,
 *   3. a binary shipped beside the profile's config in
 *      `<profile dir>/onebot-mini-bin/ffmpeg`,
 *   4. a platform binary vendored in this package's `bin/` directory
 *      (`bin/ffmpeg-<platform>-<arch>`),
 *   5. `ffmpeg` on `PATH`.
 * A missing or failing ffmpeg only means "no transcript" — the message pipeline
 * is never broken by it. All subprocess work is serialized so several voice
 * messages cannot stack CPU-bound ffmpeg processes.
 */

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configPath } from './config.js'

/** How long a single ffmpeg transcode may take before it is abandoned. */
export const TRANSCODE_TIMEOUT_MS = 30000

/**
 * Ask the gateway itself for the voice-to-text result of one message.
 *
 * NapCat exposes `fetch_ptt_text` (POST /fetch_ptt_text, body `{ message_id }`)
 * which returns the transcript QQ's own server produced for that voice message,
 * as `{ text }`. This is the preferred path: no local model, no ffmpeg, no CPU —
 * the gateway already did the work.
 * @param {{ call?: (action: string, params?: object) => Promise<any> }} connection - the live transport.
 * @param {string} messageId - the gateway message id of the voice message.
 * @param {{ log?: (note: string) => void }} [hooks] - optional diagnostics sink.
 * @returns {Promise<string>} the transcript, or '' when unavailable.
 */
export async function transcribeViaGateway(connection, messageId, hooks = {}) {
  const log = typeof hooks.log === 'function' ? hooks.log : () => {}
  const id = String(messageId ?? '').trim()
  if (id === '') return ''
  if (connection === null || connection === undefined || typeof connection.call !== 'function') return ''
  try {
    // The schema accepts a number or a string; send a number when it is numeric.
    const payload = { message_id: /^\d+$/.test(id) ? Number(id) : id }
    const data = await connection.call('fetch_ptt_text', payload)
    const text = data !== null && typeof data === 'object' && typeof data.text === 'string' ? data.text : ''
    const trimmed = text.trim()
    if (trimmed === '') log('gateway voice-to-text returned no text')
    return trimmed
  } catch (error) {
    log('gateway voice-to-text failed: ' + String(error?.message ?? error))
    return ''
  }
}

/** The output sample rate and channel count every recognizer expects. */
const TARGET_SAMPLE_RATE = 16000

/** A per-call serial queue so concurrent voice messages run ffmpeg one at a time. */
let queue = Promise.resolve()

/**
 * Run one promise-returning job after every previously queued job settled.
 * @template T
 * @param {() => Promise<T>} job - the job to run.
 * @returns {Promise<T>} the job's result.
 */
function enqueue(job) {
  const run = queue.then(job, job)
  // Keep the chain alive regardless of any single failure.
  queue = run.then(() => undefined, () => undefined)
  return run
}

/**
 * Whether a path exists and is executable.
 * @param {string} path - candidate absolute path.
 * @returns {Promise<boolean>} true when it can be spawned.
 */
async function isExecutable(path) {
  if (typeof path !== 'string' || path === '') return false
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Scan `PATH` for an executable, without a shell.
 * @param {string} name - bare program name (no extension on POSIX).
 * @returns {Promise<string | undefined>} the absolute path, or undefined.
 */
async function findOnPath(name) {
  const win = process.platform === 'win32'
  const exts = win ? ['.exe', '.com', ''] : ['']
  for (const dir of String(process.env.PATH ?? '').split(win ? ';' : ':')) {
    if (dir === '') continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * The binary shipped beside the profile config, if any.
 * @returns {string} an absolute candidate path (never guaranteed to exist).
 */
function shippedFfmpegPath() {
  return join(dirname(configPath()), 'onebot-mini-bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/**
 * The platform binary vendored in this package, if any.
 * @returns {string} an absolute candidate path (never guaranteed to exist).
 */
function vendoredFfmpegPath() {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const name = 'ffmpeg-' + process.platform + '-' + process.arch + suffix
  return fileURLToPath(new URL('./bin/' + name, import.meta.url))
}

/**
 * Resolve the ffmpeg executable to use.
 * @param {object} config - the effective plugin config.
 * @returns {Promise<string | undefined>} an absolute executable path, or undefined.
 */
export async function resolveFfmpeg(config) {
  const candidates = [
    String(config?.ffmpegPath ?? '').trim(),
    String(process.env.ONEBOT_MINI_FFMPEG ?? '').trim(),
    shippedFfmpegPath(),
    vendoredFfmpegPath(),
  ]
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate
  }
  return findOnPath('ffmpeg')
}

/**
 * Run a program to completion with a timeout, capturing stderr for diagnostics.
 * @param {string} program - absolute executable path.
 * @param {string[]} args - argument vector (no shell).
 * @param {number} timeoutMs - hard limit.
 * @returns {Promise<void>} resolves on exit code 0, rejects otherwise.
 */
function runProcess(program, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error('ffmpeg timed out after ' + timeoutMs + 'ms'))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('ffmpeg exited with code ' + code + ': ' + stderr.slice(-500)))
    })
  })
}

/**
 * Wrap raw little-endian PCM16 mono samples in a canonical 44-byte WAV header.
 *
 * ffmpeg's own WAV muxer inserts a `LIST` chunk before `data`, which the strict
 * recognizer validator rejects; building the header here keeps every field at the
 * exact offset the validator checks.
 * @param {Buffer} pcm - raw PCM16LE mono samples at {@link TARGET_SAMPLE_RATE}.
 * @returns {Buffer} a canonical 16 kHz mono PCM16 WAV.
 */
export function buildWav(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(TARGET_SAMPLE_RATE, 24)
  header.writeUInt32LE(TARGET_SAMPLE_RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/**
 * Best-effort guess of the container from magic bytes, only to give ffmpeg a
 * helpful file extension when probing.
 * @param {Buffer} bytes - the raw payload.
 * @returns {string} a file extension beginning with a dot.
 */
function guessExtension(bytes) {
  if (bytes !== undefined && bytes.length >= 12) {
    const head = bytes.toString('ascii', 0, 4)
    if (head === 'RIFF') return '.wav'
    if (head === 'OggS') return '.ogg'
    if (bytes.toString('ascii', 0, 3) === 'ID3') return '.mp3'
    if (bytes.toString('ascii', 0, 5) === '#!AMR') return '.amr'
    if (bytes.toString('ascii', 0, 6) === '#!SILK') return '.silk'
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return '.mp3'
  }
  return '.bin'
}

/**
 * Transcode one voice payload to a canonical 16 kHz mono PCM16 WAV.
 * @param {object} config - the effective plugin config (`ffmpegPath`, …).
 * @param {Buffer|Uint8Array} bytes - the downloaded voice payload.
 * @param {{ log?: (note: string) => void }} [hooks] - optional diagnostics sink.
 * @returns {Promise<Buffer | undefined>} the WAV bytes, or undefined when ffmpeg is
 *   unavailable or the payload cannot be decoded (the caller then has no
 *   transcript but the message still flows).
 */
export async function transcodeToWav(config, bytes, hooks = {}) {
  const log = typeof hooks.log === 'function' ? hooks.log : () => {}
  const ffmpeg = await resolveFfmpeg(config)
  if (ffmpeg === undefined) {
    log('voice transcription skipped: ffmpeg not found (set ffmpegPath, install ffmpeg, or ship onebot-mini-bin/ffmpeg)')
    return undefined
  }
  return enqueue(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onebot-stt-'))
    const input = join(dir, 'in' + guessExtension(bytes))
    const output = join(dir, 'out.pcm')
    try {
      await writeFile(input, bytes)
      await runProcess(
        ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', input,
          '-vn', '-ac', '1', '-ar', String(TARGET_SAMPLE_RATE),
          '-acodec', 'pcm_s16le', '-f', 's16le', output,
        ],
        TRANSCODE_TIMEOUT_MS,
      )
      const pcm = await readFile(output)
      if (pcm.length === 0) {
        log('voice transcription skipped: ffmpeg produced no audio (empty or unsupported clip)')
        return undefined
      }
      return buildWav(pcm)
    } catch (error) {
      log('voice transcription skipped: ffmpeg failed: ' + String(error?.message ?? error))
      return undefined
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
}
