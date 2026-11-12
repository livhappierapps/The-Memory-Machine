import { WorkflowEntrypoint } from "cloudflare:workers";
import { inspectArchive } from "./inspect.mjs";

export class ArchiveInspection extends WorkflowEntrypoint {
  async run(event, step) {
    const report = await step.do("Inspect archive directory", async () => {
      const report = await inspectArchive(this.env.ARCHIVES, this.env.ARCHIVE_KEY);
      await this.env.ARCHIVES.put("__archive_inspection/leo-halloween.json", JSON.stringify(report), {
        httpMetadata: { contentType: "application/json" },
      });
      return report;
    });
    const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    if (!payload?.extract) return { entries: report.entries, jsonFiles: report.json.length };
    const selected = report.json.find((entry) => /grok-backend\.json$/i.test(entry.name));
    if (!selected || selected.flags & 1 || selected.method !== 8 ||
        selected.size > 200 * 1024 * 1024 || selected.compressedSize > 32 * 1024 * 1024) {
      throw new Error("Conversation entry exceeds extraction limits or uses unsupported compression");
    }
    const offset = await step.do("Locate conversation payload", async () => {
      const part = await this.env.ARCHIVES.get(report.archiveKey, {
        range: { offset: selected.offset, length: 30 },
      });
      const bytes = await part.arrayBuffer();
      const header = new DataView(bytes);
      if (header.getUint32(0, true) !== 0x04034b50) throw new Error("Invalid ZIP local header");
      return selected.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    });
    const chunkSize = 384 * 1024;
    const pieces = Math.ceil(selected.compressedSize / chunkSize);
    for (let index = 0; index < pieces; index++) {
      await step.do(`Copy conversation piece ${index}`, async () => {
        const length = Math.min(chunkSize, selected.compressedSize - index * chunkSize);
        const part = await this.env.ARCHIVES.get(report.archiveKey, {
          range: { offset: offset + index * chunkSize, length },
        });
        if (!part) throw new Error("Missing archive range");
        await this.env.ARCHIVES.put(
          `__archive_inspection/conversation-pieces/${index}.bin`, part.body,
          { httpMetadata: { contentType: "application/octet-stream" } },
        );
      });
    }
    await step.do("Confirm conversation extraction", async () => {
      await this.env.ARCHIVES.put("__archive_inspection/extraction.json", JSON.stringify({
        ...selected, pieces, chunkSize, archiveSize: report.archiveSize,
      }), { httpMetadata: { contentType: "application/json" } });
    });
    return { entries: report.entries, pieces, size: selected.size };
  }
}
