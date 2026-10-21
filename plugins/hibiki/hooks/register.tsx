import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code'

import type { SpeakStatus } from '../types'
import { toSpeech } from './text'

const answer = atom({ plugin: 'hibiki', key: 'answer' } as const, '')
const status = atom({ plugin: 'hibiki', key: 'status' } as const, 'idle' as SpeakStatus)
const lastError = atom({ plugin: 'hibiki', key: 'error' } as const, '')

type Options = {
  endpoint: string
  voice: string
  model: string
  instructions: string
  speed: string
  player: string
  codePlaceholder: string
}

type Playback = AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult>

// Set once per load by register; read by the functions below.
let o: Options = {} as Options
// The running playback, if any. A reload unloads the module, which kills it.
let current: Playback | null = null

function requestBody(text: string): string {
  // OpenAI's create-speech members only; engine-specific options belong to the server.
  // Optional members are sent only when set (speech.cpp refuses ones a model doesn't take).
  const body: Record<string, unknown> = {
    input: text,
    voice: o.voice,
    response_format: 'pcm',
  }
  if (o.model?.trim()) body.model = o.model.trim()
  if (o.instructions?.trim()) body.instructions = o.instructions.trim()
  const speed = Number(o.speed)
  if (o.speed?.trim() && Number.isFinite(speed)) body.speed = speed

  return JSON.stringify(body)
}

async function stop($: EngineInterface) {
  const playing = current
  current = null
  if (playing) await playing.return(undefined as never)
  await update($, status, () => 'idle')
}

async function fail($: EngineInterface, message: string) {
  await update($, lastError, () => message)
  await update($, status, () => 'error')
  $.ui.toast(`読み上げに失敗: ${message}`)
}

async function speak($: EngineInterface) {
  await stop($)
  const text = toSpeech(await read($, answer), o.codePlaceholder ?? '')
  if (text === '') {
    $.ui.toast('読み上げる応答がありません')
    return
  }

  if (!o.player) {
    await fail($, 'player が未設定です（ffplay / play / paplay / aplay から選ぶ）')
    return
  }

  const playback = $.process.spawn({
    argv: ['bash', `${$.plugin.root}/bin/speak.sh`],
    input: requestBody(text),
    env: {
      TTS_URL: `${o.endpoint.replace(/\/+$/, '')}/audio/speech`,
      TTS_PLAYER: o.player ?? '',
    },
  })
  current = playback
  await update($, lastError, () => '')
  await update($, status, () => 'speaking')

  // Detached: the loop is the child's life and runs on after the hook returns.
  void (async () => {
    let stderr = ''
    let code: number | null = null
    try {
      for (;;) {
        const step = await playback.next()
        if (step.done) {
          code = step.value?.code ?? null
          break
        }
        if (step.value.stream === 'stderr') stderr += step.value.text
      }
    } catch (error) {
      stderr += String(error)
      code = 1
    }

    if (current !== playback) return // stopped or replaced
    current = null

    if (code === 0) {
      await update($, status, () => 'idle')
      return
    }
    await fail($, stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `exit ${code}`)
  })()
}

export const register: Register = (on, options) => {
  o = options as unknown as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hibiki', description: '直近の応答を読み上げる' })
    await $.command.register({ name: 'hibiki-stop', description: '読み上げを止める' })

    return next(e)
  })

  on('command.run', { command: 'hibiki' }, async $ => {
    await speak($)
    return { text: '' }
  })

  on('command.run', { command: 'hibiki-stop' }, async $ => {
    await stop($)
    return { text: '' }
  })

  on('turn.complete', async ($, e, next) => {
    // Main conversation only, and only turns that ended with an answer.
    if (e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== '') {
      await update($, answer, () => e.answer)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, answer)
    if (e.props.hasSurvey || text === '') return next(e)

    const now = await read($, status)
    const error = await read($, lastError)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {now === 'speaking' ? (
          <Button key="stop" label="■ 停止" onPress={() => void stop($)} />
        ) : (
          <Button key="speak" label="▶ 読み上げ" onPress={() => void speak($)} />
        )}
        <Text dimColor>
          {now === 'speaking' ? '再生中…' : now === 'error' ? `エラー: ${error}` : '直近の応答'}
        </Text>
      </Box>
    )
  })
}
