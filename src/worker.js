import { optimize } from './engine/pipeline.js';

self.onmessage = async (e) => {
  const { type, buffer } = e.data;

  if (type !== 'optimize') return;

  try {
    const input = new Uint8Array(buffer);
    const { output, stats } = await optimize(input, {}, (progress, pass) => {
      self.postMessage({ type: 'progress', progress, pass });
    });
    self.postMessage({ type: 'result', result: output.buffer, stats }, [output.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
