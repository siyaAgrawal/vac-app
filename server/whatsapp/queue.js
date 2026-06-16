/**
 * Message queue with typing delay simulation.
 * Ensures replies feel natural and don't all fire instantly.
 */
import { EventEmitter } from 'node:events'

export class ReplyQueue extends EventEmitter {
  constructor({ minDelay = 2000, maxDelay = 7000, typingSpeed = 40 } = {}) {
    super()
    this.queue = []
    this.processing = false
    this.minDelay = minDelay   // ms
    this.maxDelay = maxDelay   // ms
    this.typingSpeed = typingSpeed // chars per second (simulates reading + typing time)
  }

  /** Add a reply task to the queue */
  enqueue(task) {
    // task: { chatId, text, analysis, client }
    this.queue.push({ ...task, enqueuedAt: Date.now() })
    this.emit('queued', { chatId: task.chatId, queueLength: this.queue.length })
    if (!this.processing) this._process()
  }

  /** Human-like typing delay based on reply length */
  _typingDelay(text) {
    const chars = (text || '').length
    const readTime = 1500 // ms to "read" the incoming message
    const typeTime = (chars / this.typingSpeed) * 1000
    const base = readTime + typeTime
    const jitter = this.minDelay + Math.random() * (this.maxDelay - this.minDelay)
    return Math.round(base + jitter)
  }

  async _process() {
    if (this.queue.length === 0) { this.processing = false; return }
    this.processing = true

    const task = this.queue.shift()
    const delay = this._typingDelay(task.text)

    this.emit('typing_start', { chatId: task.chatId, delay })

    await sleep(delay)

    try {
      if (task.client && task.chatId && task.text) {
        // Send typing indicator if available
        try {
          const chat = await task.client.getChatById(task.chatId)
          await chat.sendStateTyping()
          await sleep(Math.min(delay * 0.3, 3000))
          await chat.clearState()
        } catch { /* typing indicator is optional */ }

        await task.client.sendMessage(task.chatId, task.text)
        this.emit('sent', { chatId: task.chatId, text: task.text, analysis: task.analysis })
        console.log(`[Queue] Sent reply to ${task.chatId}: "${task.text.slice(0, 60)}…"`)
      }
    } catch (err) {
      this.emit('error', { chatId: task.chatId, error: err.message })
      console.error(`[Queue] Send failed for ${task.chatId}:`, err.message)
    }

    // Process next item
    await sleep(500)
    this._process()
  }

  get length() { return this.queue.length }
  get isProcessing() { return this.processing }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
