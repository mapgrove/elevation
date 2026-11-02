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
  options: {
    signal?: AbortSignal;
    maxBytes: number;
    timeoutMs: number;
    range?: { offset: number; totalBytes: number };
  },
) {
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const range = options.range;
  const end = range ? range.offset + options.maxBytes - 1 : undefined;
  const response = await fetch(url, {
    signal,
    headers: range
      ? {
          Range: `bytes=${range.offset}-${end}`,
          "Accept-Encoding": "identity",
        }
      : undefined,
  });
  if (
    range &&
    (response.status !== 206 ||
      response.headers.get("content-range") !==
        `bytes ${range.offset}-${end}/${range.totalBytes}` ||
      ![null, "identity"].includes(response.headers.get("content-encoding")))
  ) {
    await response.body?.cancel();
    throw new Error(
      "Host must honor the exact byte range with HTTP 206 and Content-Range",
    );
  }
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
