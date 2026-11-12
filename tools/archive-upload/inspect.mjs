// Private, scheduled archive inspection. Never changes the original archive.
// No HTTP handler and no public route. Results stay in the private R2 bucket.
export async function inspectArchive(bucket, key) {
  const object = await bucket.head(key);
  if (!object || object.size < 22) throw new Error("Archive is missing or truncated");
  async function range(offset, length) {
    if (offset < 0 || length < 1 || offset + length > object.size) {
      throw new Error("ZIP offset outside archive");
    }
    const part = await bucket.get(key, { range: { offset, length } });
    if (!part) throw new Error("Archive disappeared");
    const bytes = new Uint8Array(await part.arrayBuffer());
    if (bytes.length !== length) throw new Error("Incomplete archive read");
    return bytes;
  }
  const tailLength = Math.min(object.size, 65557);
  const tail = await range(object.size - tailLength, tailLength);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let p = tail.length - 22; p >= 0; p--) {
    if (view.getUint32(p, true) === 0x06054b50 &&
        p + 22 + view.getUint16(p + 20, true) === tail.length) {
      end = p;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP directory trailer missing");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) {
    throw new Error("Multi-disk ZIP unsupported");
  }
  const count = view.getUint16(end + 10, true);
  const length = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (count === 65535 || length === 0xffffffff || offset === 0xffffffff) {
    throw new Error("ZIP64 requires a ZIP64 reader");
  }
  if (length > 8 * 1024 * 1024 || count > 20000) throw new Error("ZIP directory exceeds safety limit");
  const bytes = await range(offset, length);
  const directory = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = [];
  const types = {};
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > length || directory.getUint32(p, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP directory entry");
    }
    const nameLength = directory.getUint16(p + 28, true);
    const extraLength = directory.getUint16(p + 30, true);
    const commentLength = directory.getUint16(p + 32, true);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > length) throw new Error("Truncated ZIP directory entry");
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    const leaf = name.split("/").pop() || "";
    const extension = name.endsWith("/") ? "directory" :
      (leaf.includes(".") ? leaf.split(".").pop().toLowerCase() : "no-extension");
    types[extension] = (types[extension] || 0) + 1;
    if (extension === "json" && !name.startsWith("__MACOSX/")) {
      json.push({
        name,
        flags: directory.getUint16(p + 8, true),
        method: directory.getUint16(p + 10, true),
        crc32: directory.getUint32(p + 16, true),
        compressedSize: directory.getUint32(p + 20, true),
        size: directory.getUint32(p + 24, true),
        offset: directory.getUint32(p + 42, true),
      });
    }
    p = next;
  }
  if (p !== length) throw new Error("Unexpected bytes in ZIP directory");
  return { archiveKey: key, archiveSize: object.size, entries: count, types, json };
}

export default {
  async scheduled(_event, env) {
    const output = "__archive_inspection/leo-halloween.json";
    // One successful run only; repeated schedule ticks do not repeat inspection.
    if (await env.ARCHIVES.head(output)) return;
    try {
      const report = await inspectArchive(env.ARCHIVES, env.ARCHIVE_KEY);
      await env.ARCHIVES.put(output, JSON.stringify(report), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (error) {
      await env.ARCHIVES.put("__archive_inspection/error.json", JSON.stringify({
        error: error.message,
      }), { httpMetadata: { contentType: "application/json" } });
    }
  },
};
