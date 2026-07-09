import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CompanionStore } from "../src/db.js";

test("opening an old database migrates once and creates a backup", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "companion-migration-"));
  const dbPath = path.join(dir, "old.sqlite");
  const oldDb = new DatabaseSync(dbPath);
  try {
    oldDb.exec(`
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '2');

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'custom',
        tagline TEXT NOT NULL DEFAULT '',
        persona TEXT NOT NULL,
        boundaries_json TEXT NOT NULL DEFAULT '[]',
        safety_rules_json TEXT NOT NULL DEFAULT '[]',
        prompts_json TEXT NOT NULL DEFAULT '[]',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mood TEXT,
        workflow TEXT,
        safety_level TEXT,
        source TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } finally {
    oldDb.close();
  }

  const store = new CompanionStore(dbPath);
  try {
    assert.equal(store.getSchemaVersion(), 7);
    assert.ok(store.db.prepare("PRAGMA table_info(messages)").all().some((column) => column.name === "updated_at"));
    assert.ok(store.db.prepare("PRAGMA table_info(agents)").all().some((column) => column.name === "chat_background_data"));
    assert.ok(store.db.prepare("PRAGMA table_info(agents)").all().some((column) => column.name === "auto_read"));
    assert.ok(store.db.prepare("PRAGMA table_info(agents)").all().some((column) => column.name === "voice_expressiveness"));
    assert.ok(store.db.prepare("PRAGMA table_info(agents)").all().some((column) => column.name === "response_style"));
    assert.ok(store.db.prepare("PRAGMA table_info(agents)").all().some((column) => column.name === "creativity_level"));
    assert.ok(store.db.prepare("PRAGMA table_info(agents)").all().some((column) => column.name === "reply_length"));
  } finally {
    store.close();
  }

  const backups = readdirSync(dir).filter((name) => name.startsWith("old.sqlite.bak-v2-to-v7-"));
  assert.equal(backups.length, 1);
  assert.ok(existsSync(path.join(dir, backups[0])));

  const reopened = new CompanionStore(dbPath);
  try {
    assert.equal(reopened.getSchemaVersion(), 7);
  } finally {
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
