/**
 * The backup's naming and rotation, with the SQLite copy replaced by a stub:
 * what matters here is that the file name sorts chronologically, that only the
 * oldest backups beyond BACKUP_KEEP go, that a foreign file in the directory is
 * never touched, and that a failed write prunes nothing (a failed backup must
 * never be the reason an older, valid one disappears — backup.ts).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { runBackup } from "../lib/server/backup";
import type { Env } from "../lib/server/types";

const NAME = /^life-events-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;

function fakeEnv(dir: string, keep: number, backup: (file: string) => Promise<void>): Env {
  return { DB: { backup }, BACKUP_DIR: dir, BACKUP_KEEP: keep } as unknown as Env;
}

describe("runBackup", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spotify-poller-backup-"));
    writeFileSync(join(dir, "life-events-2020-01-01-0000.db"), "old");
    writeFileSync(join(dir, "life-events-2021-01-01-0000.db"), "older-but-kept");
    writeFileSync(join(dir, "notes.txt"), "not a backup");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("names the snapshot after the UTC minute and rotates the oldest beyond BACKUP_KEEP", async () => {
    const env = fakeEnv(dir, 2, async (file) => {
      writeFileSync(file, "snapshot");
    });
    const r = await runBackup(env);

    assert.match(r.file.slice(dir.length + 1), NAME);
    assert.equal(r.bytes, "snapshot".length);
    assert.ok(r.ms >= 0);
    assert.deepEqual(r.pruned, ["life-events-2020-01-01-0000.db"]);

    const left = readdirSync(dir).sort();
    assert.deepEqual(left, ["life-events-2021-01-01-0000.db", r.file.slice(dir.length + 1), "notes.txt"].sort());
  });

  it("keeps everything when BACKUP_KEEP is 0", async () => {
    const env = fakeEnv(dir, 0, async (file) => {
      writeFileSync(file, "snapshot");
    });
    const r = await runBackup(env);
    assert.deepEqual(r.pruned, []);
    assert.equal(readdirSync(dir).length, 4);
  });

  it("prunes nothing when the write fails", async () => {
    const env = fakeEnv(dir, 1, async () => {
      throw new Error("disk full");
    });
    await assert.rejects(runBackup(env), /disk full/);
    assert.ok(existsSync(join(dir, "life-events-2020-01-01-0000.db")));
    assert.ok(existsSync(join(dir, "life-events-2021-01-01-0000.db")));
  });
});
