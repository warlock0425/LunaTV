export class RemoteResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Remote response exceeds ${maxBytes} bytes`);
    this.name = 'RemoteResponseTooLargeError';
  }
}

function validateLimit(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive number');
  }
}

function rejectOversizedContentLength(
  response: Response,
  maxBytes: number
): void {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel();
    throw new RemoteResponseTooLargeError(maxBytes);
  }
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  validateLimit(maxBytes);
  rejectOversizedContentLength(response, maxBytes);
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RemoteResponseTooLargeError(maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export async function readResponseJsonWithLimit<T>(
  response: Response,
  maxBytes: number
): Promise<T> {
  const text = await readResponseTextWithLimit(response, maxBytes);
  return JSON.parse(text) as T;
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  validateLimit(maxBytes);
  rejectOversizedContentLength(response, maxBytes);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RemoteResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
