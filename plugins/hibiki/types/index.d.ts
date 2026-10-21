export type SpeakStatus = 'idle' | 'speaking' | 'error'

declare module 'claude-code' {
  interface PluginState {
    'hibiki': { answer: string; status: SpeakStatus; error: string }
  }
}
