/**
 * Web Worker for off-main-thread PDF optimization.
 *
 * Message protocol:
 *   Inbound:  { type: 'optimize', buffer: ArrayBuffer, options: object }
 *   Outbound: { type: 'progress', progress: number, pass: string }
 *           | { type: 'result', result: ArrayBuffer, stats: object }
 *           | { type: 'error', error: string }
 */
import { optimize } from './engine/pipeline.js';

self.onmessage = async (e) => {
  const { type, buffer, options } = e.data;

  if (type !== 'optimize') return;

  try {
    const input = new Uint8Array(buffer);
    const { output, stats } = await optimize(input, options || {}, (progress, pass) => {
      self.postMessage({ type: 'progress', progress, pass });
    });
    self.postMessage({ type: 'result', result: output.buffer, stats }, [output.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
