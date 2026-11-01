/** File-level progress. Bytes count only completed downloads in this call. */
export type DownloadProgress = {
  tileId: string;
  completedTiles: number;
  totalTiles: number;
  downloadedBytes: number;
};
export type DownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (event: DownloadProgress) => void;
};

/** Enforce a byte ceiling while streaming, rather than buffering an unbounded response. */
export async function fetchBytes(
  url: string,
  options: { signal?: AbortSignal; maxBytes: number; timeoutMs: number },
) {
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > options.maxBytes) {
    await response.body?.cancel();
    throw new Error("Download exceeds the allowed byte limit");
  }
  if (!response.body) throw new Error("Download response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > options.maxBytes)
        throw new Error("Download exceeds the allowed byte limit");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}
