import { openPromise } from 'yauzl';

// Launchers may rename the profile ID. Modern client JARs carry the actual
// Minecraft version independently of that display name or the asset index.
export async function clientVersion(file: string, fallback: string): Promise<string> {
  const zip = await openPromise(file).catch(() => undefined);
  if (!zip) return fallback;
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== 'version.json') continue;
      if (entry.uncompressedSize > 64 * 1024) return fallback;
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        bytes += chunk.length;
        if (bytes > 64 * 1024) return fallback;
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: unknown };
      return typeof value.id === 'string' && /^[\w.+-]{1,160}$/.test(value.id)
        ? value.id
        : fallback;
    }
    return fallback;
  } catch {
    return fallback;
  } finally {
    zip.close();
  }
}
