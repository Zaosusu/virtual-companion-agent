import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildFtsQuery, cosineSimilarity, embedText, searchableText } from "./rag.js";

const CURRENT_SCHEMA_VERSION = 8;

export class CompanionStore {
  constructor(dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.databaseExisted = existsSync(dbPath);
    this.migrationBackupPath = "";
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.enableWalMode();
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initialSchemaVersion = this.readExistingSchemaVersion();
    if (this.databaseExisted && this.initialSchemaVersion < CURRENT_SCHEMA_VERSION) {
      this.backupBeforeMigration(this.initialSchemaVersion);
    }
    this.initSchema();
  }

  enableWalMode() {
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
    } catch (error) {
      if (String(error?.message || "").includes("database is locked")) {
        console.warn("[db] WAL mode skipped because database is locked; continuing with current journal mode.");
        return;
      }
      throw error;
    }
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS model_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        base_url TEXT NOT NULL DEFAULT '',
        api_key TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        image_output_enabled INTEGER NOT NULL DEFAULT 0,
        image_base_url TEXT NOT NULL DEFAULT '',
        image_api_key TEXT NOT NULL DEFAULT '',
        image_model TEXT NOT NULL DEFAULT '',
        official_base_url TEXT NOT NULL DEFAULT '',
        official_license_key TEXT NOT NULL DEFAULT '',
        official_user_token TEXT NOT NULL DEFAULT '',
        official_model TEXT NOT NULL DEFAULT '',
        audio_base_url TEXT NOT NULL DEFAULT '',
        audio_api_key TEXT NOT NULL DEFAULT '',
        audio_model TEXT NOT NULL DEFAULT '',
        audio_voice TEXT NOT NULL DEFAULT '',
        audio_instruction TEXT NOT NULL DEFAULT '',
        audio_format TEXT NOT NULL DEFAULT 'mp3',
        audio_speed TEXT NOT NULL DEFAULT '',
        audio_volume TEXT NOT NULL DEFAULT '',
        audio_sample_rate TEXT NOT NULL DEFAULT '',
        audio_text_normalization TEXT NOT NULL DEFAULT '',
        audio_markdown_filter INTEGER NOT NULL DEFAULT 0,
        audio_return_url INTEGER NOT NULL DEFAULT 0,
        audio_timestamp INTEGER NOT NULL DEFAULT 0,
        audio_extra_body TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agent_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL DEFAULT '',
        persona TEXT NOT NULL DEFAULT '',
        voice_style TEXT NOT NULL DEFAULT '',
        relationship TEXT NOT NULL DEFAULT '',
        user_persona_enabled INTEGER NOT NULL DEFAULT 0,
        user_persona TEXT NOT NULL DEFAULT '',
        opening_message TEXT NOT NULL DEFAULT '',
        opening_suggestions_json TEXT NOT NULL DEFAULT '[]',
        system_prompt TEXT NOT NULL DEFAULT '',
        image_style TEXT NOT NULL DEFAULT 'realistic',
        visual_context TEXT NOT NULL DEFAULT '',
        boundaries_json TEXT NOT NULL DEFAULT '[]',
        safety_rules_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'custom',
        tagline TEXT NOT NULL DEFAULT '',
        persona TEXT NOT NULL,
        gender TEXT NOT NULL DEFAULT 'female',
        avatar_image_data TEXT NOT NULL DEFAULT '',
        avatar_image_mime TEXT NOT NULL DEFAULT '',
        avatar_image_name TEXT NOT NULL DEFAULT '',
        appearance TEXT NOT NULL DEFAULT '',
        voice_style TEXT NOT NULL DEFAULT '',
        relationship TEXT NOT NULL DEFAULT '',
        opening_message TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        voice_gender TEXT NOT NULL DEFAULT 'female',
        voice_tone TEXT NOT NULL DEFAULT 'warm',
        auto_read INTEGER NOT NULL DEFAULT 0,
        voice_speed TEXT NOT NULL DEFAULT '1',
        voice_volume REAL NOT NULL DEFAULT 1,
        voice_expressiveness REAL NOT NULL DEFAULT 0.6,
        voice_warmth REAL NOT NULL DEFAULT 0.7,
        voice_clarity REAL NOT NULL DEFAULT 0.65,
        response_style TEXT NOT NULL DEFAULT 'balanced',
        creativity_level REAL NOT NULL DEFAULT 0.6,
        reply_length REAL NOT NULL DEFAULT 0.35,
        cloned_voice_id TEXT NOT NULL DEFAULT '',
        voice_sample_name TEXT NOT NULL DEFAULT '',
        reference_image_data TEXT NOT NULL DEFAULT '',
        reference_image_mime TEXT NOT NULL DEFAULT '',
        reference_image_name TEXT NOT NULL DEFAULT '',
        chat_background_data TEXT NOT NULL DEFAULT '',
        chat_background_mime TEXT NOT NULL DEFAULT '',
        chat_background_name TEXT NOT NULL DEFAULT '',
        chat_background_opacity REAL NOT NULL DEFAULT 0.18,
        chat_background_blur INTEGER NOT NULL DEFAULT 0,
        chat_background_overlay INTEGER NOT NULL DEFAULT 0,
        chat_brand_visible INTEGER NOT NULL DEFAULT 1,
        boundaries_json TEXT NOT NULL DEFAULT '[]',
        safety_rules_json TEXT NOT NULL DEFAULT '[]',
        prompts_json TEXT NOT NULL DEFAULT '[]',
        quick_actions_enabled INTEGER NOT NULL DEFAULT 0,
        dialogue_state_json TEXT NOT NULL DEFAULT '{}',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        parent_id INTEGER,
        variant_group_id TEXT NOT NULL DEFAULT '',
        variant_index INTEGER NOT NULL DEFAULT 0,
        replaced_by INTEGER,
        mood TEXT,
        workflow TEXT,
        safety_level TEXT,
        source TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        compressed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.7,
        status TEXT NOT NULL DEFAULT 'active',
        pinned INTEGER NOT NULL DEFAULT 0,
        source_message_id INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        content TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        memory_id UNINDEXED,
        content,
        searchable_text,
        tokenize = 'unicode61'
      );
    `);

    const schemaVersion = this.getSchemaVersion();
    if (schemaVersion < CURRENT_SCHEMA_VERSION) {
      this.migrateToLatestSchema(schemaVersion);
    }
    this.ensureIndexes();

    this.setProfileDefault("timezone", "Asia/Shanghai");
    this.setProfileDefault("language", "zh-CN");
    this.setProfileDefault("name", "");
    this.db.prepare("INSERT OR IGNORE INTO model_config (id) VALUES (1)").run();
    this.db.prepare("INSERT OR IGNORE INTO agent_config (id) VALUES (1)").run();
    this.seedBuiltInAgents();
  }

  getSchemaVersion() {
    return Number.parseInt(this.getMeta("schema_version", "0"), 10) || 0;
  }

  readExistingSchemaVersion() {
    const hasMeta = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'
    `).get();
    if (!hasMeta) return 0;
    return Number.parseInt(
      this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value || "0",
      10
    ) || 0;
  }

  setSchemaVersion(version) {
    this.setMeta("schema_version", String(version));
  }

  migrateToLatestSchema(fromVersion) {
    const backupPath = this.backupBeforeMigration(fromVersion);
    try {
      this.db.exec("BEGIN IMMEDIATE;");
      if (fromVersion < 3) this.migrateTo3();
      if (fromVersion < 4) this.migrateTo4();
      if (fromVersion < 5) this.migrateTo5();
      if (fromVersion < 6) this.migrateTo6();
      if (fromVersion < 7) this.migrateTo7();
      if (fromVersion < 8) this.migrateTo8();
      this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
      this.db.exec("COMMIT;");
      if (backupPath) console.log(`[db] schema migrated ${fromVersion} -> ${CURRENT_SCHEMA_VERSION}; backup: ${backupPath}`);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {}
      error.message = `Database migration failed from schema ${fromVersion} to ${CURRENT_SCHEMA_VERSION}: ${error.message}`;
      throw error;
    }
  }

  backupBeforeMigration(fromVersion) {
    if (!this.databaseExisted || this.migrationBackupPath) return this.migrationBackupPath;
    try {
      this.db.exec("PRAGMA wal_checkpoint(FULL);");
    } catch {}
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const backupPath = `${this.dbPath}.bak-v${fromVersion}-to-v${CURRENT_SCHEMA_VERSION}-${stamp}`;
    copyFileSync(this.dbPath, backupPath);
    this.migrationBackupPath = backupPath;
    return backupPath;
  }

  migrateTo3() {
    this.ensureColumn("messages", "compressed_at", "TEXT");
    this.ensureColumn("messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("messages", "status", "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn("messages", "parent_id", "INTEGER");
    this.ensureColumn("messages", "variant_group_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("messages", "variant_index", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("messages", "replaced_by", "INTEGER");
    this.ensureColumn("messages", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
    this.ensureColumn("agents", "image_style", "TEXT NOT NULL DEFAULT 'realistic'");
    this.ensureColumn("agents", "tagline", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "gender", "TEXT NOT NULL DEFAULT 'female'");
    this.ensureColumn("agents", "avatar_image_data", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "avatar_image_mime", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "avatar_image_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "appearance", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "visual_context", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "voice_style", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "relationship", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "opening_message", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "system_prompt", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "voice_gender", "TEXT NOT NULL DEFAULT 'female'");
    this.ensureColumn("agents", "voice_tone", "TEXT NOT NULL DEFAULT 'warm'");
    this.ensureColumn("agents", "cloned_voice_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "voice_sample_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "reference_image_data", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "reference_image_mime", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "reference_image_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "chat_background_data", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "chat_background_mime", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "chat_background_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "chat_background_opacity", "REAL NOT NULL DEFAULT 0.18");
    this.ensureColumn("agents", "chat_background_blur", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_config", "image_output_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_config", "image_base_url", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "image_api_key", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "image_model", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "official_base_url", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "official_license_key", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "official_user_token", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "official_model", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_base_url", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_api_key", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_model", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_voice", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_instruction", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_format", "TEXT NOT NULL DEFAULT 'mp3'");
    this.ensureColumn("model_config", "audio_speed", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_volume", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_sample_rate", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_text_normalization", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("model_config", "audio_markdown_filter", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_config", "audio_return_url", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_config", "audio_timestamp", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_config", "audio_extra_body", "TEXT NOT NULL DEFAULT '{}'");
  }

  migrateTo4() {
    this.ensureColumn("agents", "auto_read", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("agents", "voice_speed", "TEXT NOT NULL DEFAULT '1'");
    this.ensureColumn("agents", "voice_volume", "REAL NOT NULL DEFAULT 1");
  }

  migrateTo5() {
    this.ensureColumn("agents", "voice_expressiveness", "REAL NOT NULL DEFAULT 0.6");
    this.ensureColumn("agents", "voice_warmth", "REAL NOT NULL DEFAULT 0.7");
    this.ensureColumn("agents", "voice_clarity", "REAL NOT NULL DEFAULT 0.65");
  }

  migrateTo6() {
    this.ensureColumn("agents", "response_style", "TEXT NOT NULL DEFAULT 'balanced'");
    this.ensureColumn("agents", "creativity_level", "REAL NOT NULL DEFAULT 0.6");
  }

  migrateTo7() {
    this.ensureColumn("agents", "reply_length", "REAL NOT NULL DEFAULT 0.35");
  }

  migrateTo8() {
    this.ensureColumn("agents", "user_persona_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("agents", "user_persona", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "opening_suggestions_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("agents", "quick_actions_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("agents", "chat_background_overlay", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("agents", "chat_brand_visible", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("agents", "dialogue_state_json", "TEXT NOT NULL DEFAULT '{}'");
  }

  ensureIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_compression ON messages(session_id, compressed_at, id);
      CREATE INDEX IF NOT EXISTS idx_memories_kind_status ON memories(kind, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chunks_memory ON memory_chunks(memory_id);
      CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category, updated_at DESC);
    `);
  }

  close() {
    this.db.close();
  }

  setProfileDefault(key, value) {
    this.db.prepare("INSERT OR IGNORE INTO profile (key, value) VALUES (?, ?)").run(key, value);
  }

  setProfile(key, value) {
    this.db.prepare(`
      INSERT INTO profile (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, String(value ?? ""));
  }

  getProfile() {
    const rows = this.db.prepare("SELECT key, value FROM profile").all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  getModelConfig() {
    const row = this.db.prepare(`
      SELECT
        enabled,
        base_url AS baseUrl,
        api_key AS apiKey,
        model,
        image_output_enabled AS imageOutputEnabled,
        image_base_url AS imageBaseUrl,
        image_api_key AS imageApiKey,
        image_model AS imageModel,
        official_base_url AS officialBaseUrl,
        official_license_key AS officialLicenseKey,
        official_user_token AS officialUserToken,
        official_model AS officialModel,
        audio_base_url AS audioBaseUrl,
        audio_api_key AS audioApiKey,
        audio_model AS audioModel,
        audio_voice AS audioVoice,
        audio_instruction AS audioInstruction,
        audio_format AS audioFormat,
        audio_speed AS audioSpeed,
        audio_volume AS audioVolume,
        audio_sample_rate AS audioSampleRate,
        audio_text_normalization AS audioTextNormalization,
        audio_markdown_filter AS audioMarkdownFilter,
        audio_return_url AS audioReturnUrl,
        audio_timestamp AS audioTimestamp,
        audio_extra_body AS audioExtraBody,
        updated_at AS updatedAt
      FROM model_config
      WHERE id = 1
    `).get();
    return row || {
      enabled: 0,
      baseUrl: "",
      apiKey: "",
      model: "",
      imageOutputEnabled: 0,
      imageBaseUrl: "",
      imageApiKey: "",
      imageModel: "",
      officialBaseUrl: "",
      officialLicenseKey: "",
      officialUserToken: "",
      officialModel: "",
      audioBaseUrl: "",
      audioApiKey: "",
      audioModel: "",
      audioVoice: "",
      audioInstruction: "",
      audioFormat: "mp3",
      audioSpeed: "",
      audioVolume: "",
      audioSampleRate: "",
      audioTextNormalization: "",
      audioMarkdownFilter: 0,
      audioReturnUrl: 0,
      audioTimestamp: 0,
      audioExtraBody: "{}",
      updatedAt: null
    };
  }

  saveModelConfig({
    enabled,
    baseUrl,
    apiKey,
    model,
    imageOutputEnabled = false,
    imageBaseUrl,
    imageApiKey,
    imageModel,
    officialBaseUrl,
    officialLicenseKey,
    officialUserToken,
    officialModel,
    audioBaseUrl,
    audioApiKey,
    audioModel,
    audioVoice,
    audioInstruction,
    audioFormat,
    audioSpeed,
    audioVolume,
    audioSampleRate,
    audioTextNormalization,
    audioMarkdownFilter,
    audioReturnUrl,
    audioTimestamp,
    audioExtraBody,
    clearApiKey = false,
    clearImageApiKey = false,
    clearOfficialLicenseKey = false,
    clearOfficialUserToken = false,
    clearAudioApiKey = false
  }) {
    const current = this.getModelConfig();
    const nextApiKey = clearApiKey ? "" : apiKey ? String(apiKey).trim() : current.apiKey;
    const nextImageApiKey = clearImageApiKey ? "" : imageApiKey ? String(imageApiKey).trim() : current.imageApiKey;
    const nextOfficialLicenseKey = clearOfficialLicenseKey
      ? ""
      : officialLicenseKey
        ? String(officialLicenseKey).trim()
        : current.officialLicenseKey;
    const nextOfficialUserToken = clearOfficialUserToken
      ? ""
      : officialUserToken
        ? String(officialUserToken).trim()
        : current.officialUserToken;
    const nextAudioApiKey = clearAudioApiKey ? "" : audioApiKey ? String(audioApiKey).trim() : current.audioApiKey;
    this.db.prepare(`
      INSERT INTO model_config (
        id, enabled, base_url, api_key, model, image_output_enabled,
        image_base_url, image_api_key, image_model,
        official_base_url, official_license_key, official_user_token, official_model,
        audio_base_url, audio_api_key, audio_model, audio_voice, audio_instruction, audio_format,
        audio_speed, audio_volume, audio_sample_rate, audio_text_normalization,
        audio_markdown_filter, audio_return_url, audio_timestamp, audio_extra_body,
        updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        base_url = excluded.base_url,
        api_key = excluded.api_key,
        model = excluded.model,
        image_output_enabled = excluded.image_output_enabled,
        image_base_url = excluded.image_base_url,
        image_api_key = excluded.image_api_key,
        image_model = excluded.image_model,
        official_base_url = excluded.official_base_url,
        official_license_key = excluded.official_license_key,
        official_user_token = excluded.official_user_token,
        official_model = excluded.official_model,
        audio_base_url = excluded.audio_base_url,
        audio_api_key = excluded.audio_api_key,
        audio_model = excluded.audio_model,
        audio_voice = excluded.audio_voice,
        audio_instruction = excluded.audio_instruction,
        audio_format = excluded.audio_format,
        audio_speed = excluded.audio_speed,
        audio_volume = excluded.audio_volume,
        audio_sample_rate = excluded.audio_sample_rate,
        audio_text_normalization = excluded.audio_text_normalization,
        audio_markdown_filter = excluded.audio_markdown_filter,
        audio_return_url = excluded.audio_return_url,
        audio_timestamp = excluded.audio_timestamp,
        audio_extra_body = excluded.audio_extra_body,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      enabled === undefined ? Number(current.enabled || 0) : enabled ? 1 : 0,
      String(baseUrl ?? current.baseUrl ?? "").trim(),
      nextApiKey,
      String(model ?? current.model ?? "").trim(),
      imageOutputEnabled === undefined ? Number(current.imageOutputEnabled || 0) : imageOutputEnabled ? 1 : 0,
      String(imageBaseUrl ?? current.imageBaseUrl ?? "").trim(),
      nextImageApiKey,
      String(imageModel ?? current.imageModel ?? "").trim(),
      String(officialBaseUrl ?? current.officialBaseUrl ?? "").trim(),
      nextOfficialLicenseKey,
      nextOfficialUserToken,
      String(officialModel ?? current.officialModel ?? "").trim(),
      String(audioBaseUrl ?? current.audioBaseUrl ?? "").trim(),
      nextAudioApiKey,
      String(audioModel ?? current.audioModel ?? "").trim(),
      String(audioVoice ?? current.audioVoice ?? "").trim(),
      String(audioInstruction ?? current.audioInstruction ?? "").trim(),
      normalizeAudioFormat(audioFormat ?? current.audioFormat),
      normalizeOptionalNumberString(audioSpeed ?? current.audioSpeed),
      normalizeOptionalNumberString(audioVolume ?? current.audioVolume),
      normalizeOptionalNumberString(audioSampleRate ?? current.audioSampleRate),
      String(audioTextNormalization ?? current.audioTextNormalization ?? "").trim(),
      audioMarkdownFilter ? 1 : 0,
      audioReturnUrl ? 1 : 0,
      audioTimestamp ? 1 : 0,
      normalizeJsonObject(audioExtraBody ?? current.audioExtraBody)
    );
    return this.getModelConfig();
  }

  getAgentConfig() {
    const row = this.db.prepare(`
      SELECT
        name,
        persona,
        voice_style AS voiceStyle,
        relationship,
        opening_message AS openingMessage,
        system_prompt AS systemPrompt,
        image_style AS imageStyle,
        visual_context AS visualContext,
        boundaries_json AS boundariesJson,
        safety_rules_json AS safetyRulesJson,
        updated_at AS updatedAt
      FROM agent_config
      WHERE id = 1
    `).get();

    return {
      name: row?.name || "",
      persona: row?.persona || "",
      voiceStyle: row?.voiceStyle || "",
      relationship: row?.relationship || "",
      openingMessage: row?.openingMessage || "",
      systemPrompt: row?.systemPrompt || "",
      boundaries: safeJson(row?.boundariesJson, []),
      safetyRules: safeJson(row?.safetyRulesJson, []),
      updatedAt: row?.updatedAt || null
    };
  }

  saveAgentConfig(config) {
    this.db.prepare(`
      INSERT INTO agent_config (
        id, name, persona, voice_style, relationship, opening_message,
        system_prompt, boundaries_json, safety_rules_json, updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        persona = excluded.persona,
        voice_style = excluded.voice_style,
        relationship = excluded.relationship,
        opening_message = excluded.opening_message,
        system_prompt = excluded.system_prompt,
        boundaries_json = excluded.boundaries_json,
        safety_rules_json = excluded.safety_rules_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      String(config.name ?? "").trim(),
      String(config.persona ?? "").trim(),
      String(config.voiceStyle ?? "").trim(),
      String(config.relationship ?? "").trim(),
      String(config.openingMessage ?? "").trim(),
      String(config.systemPrompt ?? "").trim(),
      JSON.stringify(toLines(config.boundaries)),
      JSON.stringify(toLines(config.safetyRules))
    );
    return this.getAgentConfig();
  }

  seedBuiltInAgents() {
    const count = this.db.prepare("SELECT count(*) AS count FROM agents").get()?.count || 0;
    if (count > 0) return;
    for (const agent of builtInAgents()) this.upsertAgent(agent);
    this.setMeta("active_agent_id", "mori");
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value ?? ""));
  }

  getMeta(key, fallback = "") {
    return this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value || fallback;
  }

  getActiveAgentId() {
    return this.getMeta("active_agent_id", "mori");
  }

  setActiveAgent(id) {
    if (!this.getAgent(id)) throw new Error("Agent not found");
    this.setMeta("active_agent_id", id);
  }

  getAgents() {
    return this.db.prepare(`
      SELECT
        id, name, avatar, category, tagline, persona, gender,
        avatar_image_data AS avatarImageData,
        avatar_image_mime AS avatarImageMime,
        avatar_image_name AS avatarImageName,
        is_builtin AS isBuiltin,
        updated_at AS updatedAt
      FROM agents
      ORDER BY is_builtin DESC, updated_at DESC
    `).all().map((row) => ({
      ...row,
      avatarImage: row.avatarImageData ? {
        data: row.avatarImageData,
        mime: row.avatarImageMime || "image/png",
        name: row.avatarImageName || "avatar-image"
      } : null
    }));
  }

  getAgent(id) {
    const row = this.db.prepare(`
      SELECT
        id, name, avatar, category, tagline, persona, gender,
        avatar_image_data AS avatarImageData,
        avatar_image_mime AS avatarImageMime,
        avatar_image_name AS avatarImageName,
        appearance,
        voice_style AS voiceStyle,
        relationship,
        user_persona_enabled AS userPersonaEnabled,
        user_persona AS userPersona,
        opening_message AS openingMessage,
        opening_suggestions_json AS openingSuggestionsJson,
        system_prompt AS systemPrompt,
        image_style AS imageStyle,
        visual_context AS visualContext,
        voice_gender AS voiceGender,
        voice_tone AS voiceTone,
        auto_read AS autoRead,
        voice_speed AS voiceSpeed,
        voice_volume AS voiceVolume,
        voice_expressiveness AS voiceExpressiveness,
        voice_warmth AS voiceWarmth,
        voice_clarity AS voiceClarity,
        response_style AS responseStyle,
        creativity_level AS creativityLevel,
        reply_length AS replyLength,
        cloned_voice_id AS clonedVoiceId,
        voice_sample_name AS voiceSampleName,
        reference_image_data AS referenceImageData,
        reference_image_mime AS referenceImageMime,
        reference_image_name AS referenceImageName,
        chat_background_data AS chatBackgroundData,
        chat_background_mime AS chatBackgroundMime,
        chat_background_name AS chatBackgroundName,
        chat_background_opacity AS chatBackgroundOpacity,
        chat_background_blur AS chatBackgroundBlur,
        chat_background_overlay AS chatBackgroundOverlay,
        chat_brand_visible AS chatBrandVisible,
        boundaries_json AS boundariesJson,
        safety_rules_json AS safetyRulesJson,
        prompts_json AS promptsJson,
        quick_actions_enabled AS quickActionsEnabled,
        dialogue_state_json AS dialogueStateJson,
        is_builtin AS isBuiltin,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM agents
      WHERE id = ?
    `).get(id);
    return row ? deserializeAgent(row) : null;
  }

  getActiveAgent() {
    return this.getAgent(this.getActiveAgentId()) || this.getAgent("mori") || this.getAgents()[0];
  }

  upsertAgent(agent) {
    const id = slug(agent.id || agent.name || `agent_${Date.now()}`);
    this.db.prepare(`
      INSERT INTO agents (
        id, name, avatar, category, tagline, persona, gender,
        avatar_image_data, avatar_image_mime, avatar_image_name,
        appearance, voice_style, relationship, user_persona_enabled, user_persona,
        opening_message, opening_suggestions_json, system_prompt, image_style, visual_context,
        voice_gender, voice_tone, auto_read, voice_speed, voice_volume,
        voice_expressiveness, voice_warmth, voice_clarity,
        response_style, creativity_level, reply_length,
        cloned_voice_id, voice_sample_name,
        reference_image_data, reference_image_mime, reference_image_name,
        chat_background_data, chat_background_mime, chat_background_name,
        chat_background_opacity, chat_background_blur, chat_background_overlay, chat_brand_visible,
        boundaries_json, safety_rules_json,
        prompts_json, quick_actions_enabled, dialogue_state_json, is_builtin, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar = excluded.avatar,
        category = excluded.category,
        tagline = excluded.tagline,
        persona = excluded.persona,
        gender = excluded.gender,
        avatar_image_data = excluded.avatar_image_data,
        avatar_image_mime = excluded.avatar_image_mime,
        avatar_image_name = excluded.avatar_image_name,
        appearance = excluded.appearance,
        voice_style = excluded.voice_style,
        relationship = excluded.relationship,
        user_persona_enabled = excluded.user_persona_enabled,
        user_persona = excluded.user_persona,
        opening_message = excluded.opening_message,
        opening_suggestions_json = excluded.opening_suggestions_json,
        system_prompt = excluded.system_prompt,
        image_style = excluded.image_style,
        visual_context = excluded.visual_context,
        voice_gender = excluded.voice_gender,
        voice_tone = excluded.voice_tone,
        auto_read = excluded.auto_read,
        voice_speed = excluded.voice_speed,
        voice_volume = excluded.voice_volume,
        voice_expressiveness = excluded.voice_expressiveness,
        voice_warmth = excluded.voice_warmth,
        voice_clarity = excluded.voice_clarity,
        response_style = excluded.response_style,
        creativity_level = excluded.creativity_level,
        reply_length = excluded.reply_length,
        cloned_voice_id = excluded.cloned_voice_id,
        voice_sample_name = excluded.voice_sample_name,
        reference_image_data = excluded.reference_image_data,
        reference_image_mime = excluded.reference_image_mime,
        reference_image_name = excluded.reference_image_name,
        chat_background_data = excluded.chat_background_data,
        chat_background_mime = excluded.chat_background_mime,
        chat_background_name = excluded.chat_background_name,
        chat_background_opacity = excluded.chat_background_opacity,
        chat_background_blur = excluded.chat_background_blur,
        chat_background_overlay = excluded.chat_background_overlay,
        chat_brand_visible = excluded.chat_brand_visible,
        boundaries_json = excluded.boundaries_json,
        safety_rules_json = excluded.safety_rules_json,
        prompts_json = excluded.prompts_json,
        quick_actions_enabled = excluded.quick_actions_enabled,
        dialogue_state_json = excluded.dialogue_state_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      String(agent.name || "未命名角色").trim(),
      String(agent.avatar || "").trim(),
      String(agent.category || "custom").trim(),
      String(agent.tagline || "").trim(),
      String(agent.persona || "").trim(),
      normalizeAgentGender(agent.gender, agent.voiceGender),
      agent.clearAvatarImage ? "" : String(agent.avatarImage?.data || agent.avatarImageData || "").trim(),
      agent.clearAvatarImage ? "" : String(agent.avatarImage?.mime || agent.avatarImageMime || "").trim(),
      agent.clearAvatarImage ? "" : String(agent.avatarImage?.name || agent.avatarImageName || "").trim(),
      String(agent.appearance || "").trim(),
      String(agent.voiceStyle || "").trim(),
      String(agent.relationship || "").trim(),
      normalizeBoolean(agent.userPersonaEnabled),
      String(agent.userPersona || "").trim(),
      String(agent.openingMessage || "").trim(),
      JSON.stringify(normalizeTextArray(agent.openingSuggestions, 3, 180)),
      String(agent.systemPrompt || "").trim(),
      normalizeImageStyle(agent.imageStyle),
      String(agent.visualContext || "").trim(),
      normalizeVoiceGender(agent.voiceGender),
      normalizeVoiceTone(agent.voiceTone),
      normalizeAutoRead(agent.autoRead),
      normalizeVoiceSpeed(agent.voiceSpeed),
      normalizeVoiceVolume(agent.voiceVolume),
      normalizeRatio(agent.voiceExpressiveness, 0.6),
      normalizeRatio(agent.voiceWarmth, 0.7),
      normalizeRatio(agent.voiceClarity, 0.65),
      normalizeResponseStyle(agent.responseStyle),
      normalizeRatio(agent.creativityLevel, 0.6),
      normalizeRatio(agent.replyLength, 0.35),
      String(agent.clonedVoiceId || "").trim(),
      String(agent.voiceSampleName || "").trim(),
      agent.clearReferenceImage ? "" : String(agent.referenceImage?.data || agent.referenceImageData || "").trim(),
      agent.clearReferenceImage ? "" : String(agent.referenceImage?.mime || agent.referenceImageMime || "").trim(),
      agent.clearReferenceImage ? "" : String(agent.referenceImage?.name || agent.referenceImageName || "").trim(),
      agent.clearChatBackground ? "" : String(agent.chatBackground?.data || agent.chatBackgroundData || "").trim(),
      agent.clearChatBackground ? "" : String(agent.chatBackground?.mime || agent.chatBackgroundMime || "").trim(),
      agent.clearChatBackground ? "" : String(agent.chatBackground?.name || agent.chatBackgroundName || "").trim(),
      normalizeChatBackgroundOpacity(agent.chatBackgroundOpacity),
      normalizeChatBackgroundBlur(agent.chatBackgroundBlur),
      normalizeBoolean(agent.chatBackgroundOverlay),
      agent.chatBrandVisible === false ? 0 : 1,
      JSON.stringify(toLines(agent.boundaries)),
      JSON.stringify(toLines(agent.safetyRules)),
      JSON.stringify(Array.isArray(agent.prompts) ? agent.prompts : []),
      normalizeBoolean(agent.quickActionsEnabled),
      normalizeJsonObject(agent.dialogueState),
      agent.isBuiltin ? 1 : 0
    );
    return this.getAgent(id);
  }

  createAgentFromTemplate(templateId) {
    const template = this.getAgent(templateId);
    if (!template) throw new Error("Template not found");
    const id = `${template.id}_${Date.now().toString(36)}`;
    return this.upsertAgent({
      ...template,
      id,
      name: `${template.name} 副本`,
      isBuiltin: false,
      category: "custom"
    });
  }

  deleteAgent(id) {
    const agent = this.getAgent(id);
    if (!agent) return false;
    if (agent.isBuiltin) throw new Error("Built-in agents cannot be deleted");
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    if (this.getActiveAgentId() === id) {
      const next = this.getAgent("mori") || this.getAgents()[0] || null;
      if (!next) throw new Error("At least one agent is required");
      this.setMeta("active_agent_id", next.id);
    }
    return true;
  }

  saveAgentDialogueState(id, dialogueState = {}) {
    this.db.prepare(`
      UPDATE agents
      SET dialogue_state_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(normalizeJsonObject(dialogueState), id);
    return this.getAgent(id);
  }

  addMessage({
    sessionId = "default",
    role,
    content,
    status = "active",
    parentId = null,
    variantGroupId = "",
    variantIndex = 0,
    replacedBy = null,
    mood = null,
    workflow = null,
    safetyLevel = null,
    source = null,
    metadata = {}
  }) {
    const result = this.db.prepare(`
      INSERT INTO messages (
        session_id, role, content, status, parent_id, variant_group_id, variant_index, replaced_by,
        mood, workflow, safety_level, source, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      role,
      content,
      normalizeMessageStatus(status),
      parentId == null ? null : Number(parentId),
      String(variantGroupId || ""),
      Number.isFinite(Number(variantIndex)) ? Number(variantIndex) : 0,
      replacedBy == null ? null : Number(replacedBy),
      mood,
      workflow,
      safetyLevel,
      source,
      JSON.stringify(metadata || {})
    );
    return Number(result.lastInsertRowid);
  }

  getMessage(id) {
    const row = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE id = ?
      LIMIT 1
    `).get(Number(id));
    return row ? messageFromRow(row) : null;
  }

  getMessageByRequestId({ sessionId = "default", requestId, role = "" }) {
    const cleanRequestId = String(requestId || "").trim();
    if (!cleanRequestId) return null;
    const row = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE session_id = ? AND status = 'active'
        AND json_extract(metadata_json, '$.requestId') = ?
        AND (? = '' OR role = ?)
      ORDER BY id DESC
      LIMIT 1
    `).get(sessionId, cleanRequestId, role, role);
    return row ? messageFromRow(row) : null;
  }

  patchMessageMetadata(id, patch = {}) {
    const message = this.getMessage(id);
    if (!message) return null;
    const metadata = { ...(message.metadata || {}), ...(patch || {}) };
    this.db.prepare(`
      UPDATE messages
      SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(metadata), Number(id));
    return this.getMessage(id);
  }

  getRecentMessages(sessionId = "default", limit = 16) {
    const rows = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE session_id = ? AND status = 'active'
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, limit).reverse();
    return rows.map(messageFromRow);
  }

  getMessagesBefore({ sessionId = "default", beforeId, limit = 30 }) {
    const rows = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE session_id = ? AND id < ? AND status = 'active'
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, Number(beforeId), Number(limit)).reverse();
    return rows.map(messageFromRow);
  }

  deleteRecentAssistantTextMessage({ sessionId = "default", content, withinLast = 6 }) {
    const clean = String(content || "").trim();
    if (!clean) return 0;
    const rows = this.db.prepare(`
      SELECT id, content, metadata_json AS metadataJson
      FROM messages
      WHERE session_id = ?
        AND role = 'assistant'
        AND status = 'active'
        AND (source IS NULL OR source != 'tool:voice.speech')
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, withinLast);
    const target = rows.find((row) => row.content === clean && safeJson(row.metadataJson, {}).type !== "voice");
    if (!target) return 0;
    return Number(this.db.prepare("DELETE FROM messages WHERE id = ?").run(target.id).changes || 0);
  }

  deleteMessage({ sessionId = "default", id }) {
    const result = this.db.prepare("DELETE FROM messages WHERE session_id = ? AND id = ?").run(sessionId, Number(id));
    return Number(result.changes || 0);
  }

  clearMessages(sessionId = "default") {
    const result = this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    return Number(result.changes || 0);
  }

  getLastActiveAssistantMessage(sessionId = "default") {
    const row = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE session_id = ?
        AND role = 'assistant'
        AND status = 'active'
        AND (source IS NULL OR source != 'tool:voice.speech')
      ORDER BY id DESC
      LIMIT 1
    `).get(sessionId);
    return row ? messageFromRow(row) : null;
  }

  getLastActiveUserMessage(sessionId = "default") {
    const row = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE session_id = ? AND role = 'user' AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `).get(sessionId);
    return row ? messageFromRow(row) : null;
  }

  editLastUserMessage({ sessionId = "default", id, content }) {
    const clean = String(content || "").trim();
    if (!clean) throw new Error("Edited message cannot be empty");
    return this.runInTransaction(() => {
      const target = this.getMessage(id);
      const lastUser = this.getLastActiveUserMessage(sessionId);
      if (!target || target.sessionId !== sessionId || target.role !== "user" || target.status !== "active") {
        throw new Error("No active user message to edit");
      }
      if (!lastUser || Number(lastUser.id) !== Number(target.id)) {
        throw new Error("Only the last user message can be edited");
      }
      const revisions = Array.isArray(target.metadata?.revisions) ? target.metadata.revisions.slice(-4) : [];
      const metadata = {
        ...(target.metadata || {}),
        editedAt: new Date().toISOString(),
        revisions: [...revisions, { content: target.content, editedAt: new Date().toISOString() }]
      };
      this.db.prepare(`
        UPDATE messages
        SET content = ?, compressed_at = NULL, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND session_id = ? AND role = 'user' AND status = 'active'
      `).run(clean, JSON.stringify(metadata), Number(id), sessionId);
      this.db.prepare(`
        UPDATE messages
        SET status = 'replaced', updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND parent_id = ? AND role = 'assistant' AND status = 'active'
      `).run(sessionId, Number(id));
      this.db.prepare("DELETE FROM memories WHERE source_message_id = ?").run(Number(id));
      return this.getMessage(id);
    });
  }

  getActiveMessagesBefore({ sessionId = "default", beforeId, limit = 20 }) {
    const rows = this.db.prepare(`
      SELECT
        id, session_id AS sessionId, role, content, status, parent_id AS parentId,
        variant_group_id AS variantGroupId, variant_index AS variantIndex,
        replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt,
        updated_at AS updatedAt
      FROM messages
      WHERE session_id = ? AND id < ? AND status = 'active'
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, Number(beforeId), Number(limit)).reverse();
    return rows.map(messageFromRow);
  }

  replaceAssistantMessage({ oldMessageId, newMessage }) {
    return this.runInTransaction(() => {
      const oldMessage = this.getMessage(oldMessageId);
      if (!oldMessage || oldMessage.role !== "assistant" || oldMessage.status !== "active") {
        throw new Error("No active assistant message to replace");
      }
      const newMessageId = this.addMessage(newMessage);
      this.db.prepare(`
        UPDATE messages
        SET status = 'replaced',
            replaced_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'
      `).run(newMessageId, Number(oldMessageId));
      return this.getMessage(newMessageId);
    });
  }

  getUncompressedMessageCount(sessionId = "default") {
    const row = this.db.prepare(`
      SELECT count(*) AS count
      FROM messages
      WHERE session_id = ? AND compressed_at IS NULL AND status = 'active'
    `).get(sessionId);
    return Number(row?.count || 0);
  }

  getOldestUncompressedMessages(sessionId = "default", limit = 100) {
    return this.db.prepare(`
      SELECT id, role, content, mood, workflow, safety_level AS safetyLevel, created_at AS createdAt
      FROM messages
      WHERE session_id = ? AND compressed_at IS NULL AND status = 'active'
      ORDER BY id ASC
      LIMIT ?
    `).all(sessionId, limit);
  }

  markMessagesCompressed(ids) {
    if (!ids.length) return;
    const update = this.db.prepare("UPDATE messages SET compressed_at = CURRENT_TIMESTAMP WHERE id = ?");
    for (const id of ids) update.run(id);
  }

  runInTransaction(task) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = task();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  upsertMemory({ kind, content, importance = 0.55, confidence = 0.75, sourceMessageId = null, metadata = {} }) {
    const clean = String(content || "").trim();
    if (!clean) return null;

    const existing = this.db.prepare(`
      SELECT id FROM memories
      WHERE kind = ? AND content = ? AND status = 'active'
      LIMIT 1
    `).get(kind, clean);

    if (existing) {
      this.db.prepare(`
        UPDATE memories
        SET importance = max(importance, ?),
            confidence = max(confidence, ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(importance, confidence, existing.id);
      return existing.id;
    }

    const id = `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(`
      INSERT INTO memories (id, kind, content, importance, confidence, source_message_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, kind, clean, importance, confidence, sourceMessageId, JSON.stringify(metadata));

    this.addMemoryChunk({ memoryId: id, content: clean });
    return id;
  }

  saveMemoryCapsule({ agentId, content }) {
    const cleanAgentId = String(agentId || "").trim();
    const clean = String(content || "").trim().slice(0, 6000);
    return this.runInTransaction(() => {
      const existing = this.db.prepare(`
        SELECT id FROM memories
        WHERE kind = 'memory_capsule' AND status = 'active'
          AND json_extract(metadata_json, '$.agentId') = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(cleanAgentId);
      if (!clean) {
        if (existing) this.db.prepare("UPDATE memories SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
        return null;
      }
      if (existing) {
        this.db.prepare(`
          UPDATE memories
          SET content = ?, importance = 1, confidence = 1, pinned = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(clean, existing.id);
        this.db.prepare("DELETE FROM memory_chunks WHERE memory_id = ?").run(existing.id);
        this.db.prepare("DELETE FROM memory_chunks_fts WHERE memory_id = ?").run(existing.id);
        this.addMemoryChunk({ memoryId: existing.id, content: clean });
        return existing.id;
      }
      const id = `memory_capsule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      this.db.prepare(`
        INSERT INTO memories (id, kind, content, importance, confidence, pinned, metadata_json)
        VALUES (?, 'memory_capsule', ?, 1, 1, 1, ?)
      `).run(id, clean, JSON.stringify({ agentId: cleanAgentId, memoryCapsule: true, explicit: true }));
      this.addMemoryChunk({ memoryId: id, content: clean });
      return id;
    });
  }

  updateMemory({ id, agentId, content, importance, confirmed, pinned }) {
    const memoryId = String(id || "").trim();
    const cleanAgentId = String(agentId || "").trim();
    const row = this.db.prepare(`
      SELECT id, kind, content, importance, confidence, pinned, status, metadata_json AS metadataJson
      FROM memories
      WHERE id = ? AND status = 'active'
    `).get(memoryId);
    if (!row || !memoryBelongsToAgent(row, cleanAgentId)) return null;

    const metadata = safeJson(row.metadataJson, {});
    if (typeof confirmed === "boolean") metadata.confirmed = confirmed;
    const nextContent = content === undefined ? row.content : String(content || "").trim().slice(0, 12_000);
    if (!nextContent) return null;
    const nextImportance = importance === undefined
      ? Number(row.importance || 0.5)
      : Math.min(1, Math.max(0.2, Number(importance) || 0.5));
    const nextPinned = pinned === undefined ? Boolean(row.pinned) : Boolean(pinned);

    return this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE memories
        SET content = ?, importance = ?, pinned = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextContent, nextImportance, nextPinned ? 1 : 0, JSON.stringify(metadata), memoryId);
      if (nextContent !== row.content) {
        this.db.prepare("DELETE FROM memory_chunks WHERE memory_id = ?").run(memoryId);
        this.db.prepare("DELETE FROM memory_chunks_fts WHERE memory_id = ?").run(memoryId);
        this.addMemoryChunk({ memoryId, content: nextContent });
      }
      return this.getMemory(memoryId);
    });
  }

  deleteMemory({ id, agentId }) {
    const memoryId = String(id || "").trim();
    const cleanAgentId = String(agentId || "").trim();
    const row = this.db.prepare(`
      SELECT id, metadata_json AS metadataJson
      FROM memories
      WHERE id = ? AND status = 'active'
    `).get(memoryId);
    if (!row || !memoryBelongsToAgent(row, cleanAgentId)) return false;
    return this.runInTransaction(() => {
      this.db.prepare("UPDATE memories SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(memoryId);
      this.db.prepare("DELETE FROM memory_chunks WHERE memory_id = ?").run(memoryId);
      this.db.prepare("DELETE FROM memory_chunks_fts WHERE memory_id = ?").run(memoryId);
      return true;
    });
  }

  getMemory(id) {
    const row = this.db.prepare(`
      SELECT id, kind, content AS text, importance, confidence, pinned,
             metadata_json AS metadataJson, updated_at AS at
      FROM memories
      WHERE id = ? AND status = 'active'
    `).get(String(id || "").trim());
    return row ? publicMemory(row) : null;
  }

  addMemoryChunk({ memoryId, content }) {
    const id = `chunk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const search = searchableText(content);
    const embedding = JSON.stringify(embedText(content));
    this.db.prepare(`
      INSERT INTO memory_chunks (id, memory_id, content, searchable_text, embedding_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, memoryId, content, search, embedding);

    this.db.prepare(`
      INSERT INTO memory_chunks_fts (chunk_id, memory_id, content, searchable_text)
      VALUES (?, ?, ?, ?)
    `).run(id, memoryId, content, search);
    return id;
  }

  retrieveMemories(query, { limit = 8, agentId = "" } = {}) {
    const queryEmbedding = embedText(query);
    const candidates = new Map();
    const ftsQuery = buildFtsQuery(query);
    const agentFilter = String(agentId || "").trim();

    if (ftsQuery) {
      try {
        const rows = this.db.prepare(`
          SELECT
            c.id AS chunkId,
            c.memory_id AS memoryId,
            c.content,
            c.embedding_json AS embeddingJson,
            m.kind,
            m.importance,
            m.confidence,
            m.created_at AS createdAt,
            m.updated_at AS updatedAt,
            bm25(memory_chunks_fts) AS rank
          FROM memory_chunks_fts
          JOIN memory_chunks c ON c.id = memory_chunks_fts.chunk_id
          JOIN memories m ON m.id = c.memory_id
          WHERE memory_chunks_fts MATCH ? AND m.status = 'active'
            AND (? = '' OR json_extract(m.metadata_json, '$.agentId') = ? OR json_extract(m.metadata_json, '$.sessionId') = ?)
          ORDER BY rank
          LIMIT 40
        `).all(ftsQuery, agentFilter, agentFilter, agentFilter);
        for (const row of rows) candidates.set(row.chunkId, { ...row, ftsScore: 1 / (1 + Math.abs(row.rank || 0)) });
      } catch {
        // Bad FTS syntax should never block chat; vector/recent retrieval still runs.
      }
    }

    const broadRows = this.db.prepare(`
      SELECT
        c.id AS chunkId,
        c.memory_id AS memoryId,
        c.content,
        c.embedding_json AS embeddingJson,
        m.kind,
        m.importance,
        m.confidence,
        m.created_at AS createdAt,
        m.updated_at AS updatedAt,
        0 AS ftsScore
      FROM memory_chunks c
      JOIN memories m ON m.id = c.memory_id
      WHERE m.status = 'active'
        AND (? = '' OR json_extract(m.metadata_json, '$.agentId') = ? OR json_extract(m.metadata_json, '$.sessionId') = ?)
      ORDER BY m.pinned DESC, m.importance DESC, m.updated_at DESC
      LIMIT 300
    `).all(agentFilter, agentFilter, agentFilter);

    for (const row of broadRows) {
      if (!candidates.has(row.chunkId)) candidates.set(row.chunkId, row);
    }

    const scored = [...candidates.values()].map((row) => {
      const embedding = safeJson(row.embeddingJson, []);
      const semanticScore = cosineSimilarity(queryEmbedding, embedding);
      const importanceScore = Number(row.importance || 0.5);
      const confidenceScore = Number(row.confidence || 0.7);
      const recencyScore = recency(row.updatedAt || row.createdAt);
      const score = (semanticScore * 0.5) + ((row.ftsScore || 0) * 0.25) + (importanceScore * 0.15) + (confidenceScore * 0.05) + (recencyScore * 0.05);
      return {
        memoryId: row.memoryId,
        chunkId: row.chunkId,
        kind: row.kind,
        content: row.content,
        score: Number(score.toFixed(4)),
        semanticScore: Number(semanticScore.toFixed(4)),
        ftsScore: Number((row.ftsScore || 0).toFixed(4)),
        importance: row.importance,
        confidence: row.confidence,
        updatedAt: row.updatedAt
      };
    }).sort((left, right) => right.score - left.score).slice(0, limit);

    if (scored.length) {
      const ids = [...new Set(scored.map((item) => item.memoryId))];
      const update = this.db.prepare(`
        UPDATE memories
        SET access_count = access_count + 1,
            last_accessed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      for (const id of ids) update.run(id);
    }

    return scored;
  }

  scanMemories({ terms = [], limit = 40, agentId = "" } = {}) {
    const agentFilter = String(agentId || "").trim();
    const cleanTerms = [...new Set((Array.isArray(terms) ? terms : [])
      .map((term) => String(term || "").trim())
      .filter((term) => term.length >= 2))]
      .slice(0, 12);
    if (!cleanTerms.length) return [];

    const rows = this.db.prepare(`
      SELECT
        c.id AS chunkId,
        c.memory_id AS memoryId,
        c.content,
        c.embedding_json AS embeddingJson,
        m.kind,
        m.importance,
        m.confidence,
        m.created_at AS createdAt,
        m.updated_at AS updatedAt,
        0 AS ftsScore
      FROM memory_chunks c
      JOIN memories m ON m.id = c.memory_id
      WHERE m.status = 'active'
        AND (? = '' OR json_extract(m.metadata_json, '$.agentId') = ? OR json_extract(m.metadata_json, '$.sessionId') = ?)
      ORDER BY m.pinned DESC, m.importance DESC, m.updated_at DESC
      LIMIT 1000
    `).all(agentFilter, agentFilter, agentFilter);

    const queryText = cleanTerms.join(" ");
    const queryEmbedding = embedText(queryText);
    return rows
      .map((row) => {
        const hitCount = cleanTerms.reduce((sum, term) => sum + (String(row.content || "").includes(term) ? 1 : 0), 0);
        if (!hitCount) return null;
        const semanticScore = cosineSimilarity(queryEmbedding, safeJson(row.embeddingJson, []));
        return {
          memoryId: row.memoryId,
          chunkId: row.chunkId,
          kind: row.kind,
          content: row.content,
          score: Number(Math.min(1, 0.18 + (hitCount * 0.08) + (semanticScore * 0.25)).toFixed(4)),
          semanticScore: Number(semanticScore.toFixed(4)),
          ftsScore: Number(Math.min(1, hitCount / cleanTerms.length).toFixed(4)),
          importance: row.importance,
          confidence: row.confidence,
          updatedAt: row.updatedAt,
          scanHits: hitCount
        };
      })
      .filter(Boolean)
      .sort((left, right) => (right.scanHits - left.scanHits) || (right.score - left.score))
      .slice(0, limit);
  }

  getMemorySnapshot({ perKind = 8, agentId = "" } = {}) {
    const profile = this.getProfile();
    const agentFilter = String(agentId || "").trim();
    const rows = this.db.prepare(`
      SELECT id, kind, content AS text, importance, confidence, pinned, metadata_json AS metadataJson, updated_at AS at
      FROM memories
      WHERE status = 'active'
        AND (? = '' OR json_extract(metadata_json, '$.agentId') = ? OR json_extract(metadata_json, '$.sessionId') = ?)
      ORDER BY pinned DESC, importance DESC, updated_at DESC
      LIMIT 100
    `).all(agentFilter, agentFilter, agentFilter);

    const byKind = (kind) => rows
      .filter((row) => row.kind === kind)
      .slice(0, perKind)
      .map(publicMemory);

    return {
      profile,
      facts: byKind("fact"),
      preferences: byKind("preference"),
      emotional_patterns: byKind("emotional_pattern"),
      persona_style: byKind("persona_style"),
      persona_values: byKind("persona_value"),
      persona_catchphrases: byKind("persona_catchphrase"),
      persona_corpus: byKind("persona_corpus"),
      memory_capsule: byKind("memory_capsule"),
      recent_summaries: this.getRecentSummaries({ agentId }),
      safety_notes: byKind("safety_note"),
      updated_at: new Date().toISOString()
    };
  }

  getRecentSummaries({ limit = 12, agentId = "" } = {}) {
    const agentFilter = String(agentId || "").trim();
    return this.db.prepare(`
      SELECT content AS assistant, kind AS workflow, updated_at AS at
      FROM memories
      WHERE kind = 'summary' AND status = 'active'
        AND (? = '' OR json_extract(metadata_json, '$.agentId') = ? OR json_extract(metadata_json, '$.sessionId') = ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(agentFilter, agentFilter, agentFilter, limit);
  }

  exportUserBackup() {
    const messages = this.db.prepare(`
      SELECT id, session_id AS sessionId, role, content, status, parent_id AS parentId,
             variant_group_id AS variantGroupId, variant_index AS variantIndex,
             replaced_by AS replacedBy, mood, workflow, safety_level AS safetyLevel,
             source, metadata_json AS metadataJson, compressed_at AS compressedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM messages
      ORDER BY id ASC
    `).all().map(messageFromRow);
    const memories = this.db.prepare(`
      SELECT id, kind, content, importance, confidence, status, pinned,
             source_message_id AS sourceMessageId, metadata_json AS metadataJson,
             created_at AS createdAt, updated_at AS updatedAt,
             last_accessed_at AS lastAccessedAt, access_count AS accessCount
      FROM memories
      ORDER BY created_at ASC, id ASC
    `).all().map(({ metadataJson, ...row }) => ({ ...row, metadata: safeJson(metadataJson, {}) }));
    const profile = this.db.prepare("SELECT key, value, updated_at AS updatedAt FROM profile ORDER BY key").all();
    return {
      format: "2link-desktop-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      activeAgentId: this.getActiveAgentId(),
      agents: this.getAgents().map((agent) => this.getAgent(agent.id)).filter(Boolean),
      messages,
      memories,
      profile
    };
  }

  importUserBackup(backup = {}) {
    validateUserBackup(backup);
    return this.runInTransaction(() => {
      this.db.exec(`
        DELETE FROM memory_chunks_fts;
        DELETE FROM memory_chunks;
        DELETE FROM memories;
        DELETE FROM messages;
        DELETE FROM agents;
        DELETE FROM profile;
        DELETE FROM meta WHERE key LIKE 'chat_request:%';
      `);

      for (const agent of backup.agents) this.upsertAgent({ ...agent, isBuiltin: Boolean(agent.isBuiltin) });
      const insertMessage = this.db.prepare(`
        INSERT INTO messages (
          id, session_id, role, content, status, parent_id, variant_group_id, variant_index,
          replaced_by, mood, workflow, safety_level, source, metadata_json,
          compressed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const message of [...backup.messages].sort((left, right) => Number(left.id) - Number(right.id))) {
        insertMessage.run(
          Number(message.id), String(message.sessionId || "default"), String(message.role || "user"),
          String(message.content || ""), normalizeMessageStatus(message.status), nullableNumber(message.parentId),
          String(message.variantGroupId || ""), Number(message.variantIndex || 0), nullableNumber(message.replacedBy),
          message.mood || null, message.workflow || null, message.safetyLevel || null, message.source || null,
          JSON.stringify(message.metadata || {}), message.compressedAt || null,
          message.createdAt || new Date().toISOString(), message.updatedAt || message.createdAt || new Date().toISOString()
        );
      }

      const insertMemory = this.db.prepare(`
        INSERT INTO memories (
          id, kind, content, importance, confidence, status, pinned, source_message_id,
          metadata_json, created_at, updated_at, last_accessed_at, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const memory of backup.memories) {
        const content = String(memory.content || "").trim();
        if (!content) continue;
        insertMemory.run(
          String(memory.id), String(memory.kind || "fact"), content,
          Math.min(1, Math.max(0, Number(memory.importance ?? 0.5))),
          Math.min(1, Math.max(0, Number(memory.confidence ?? 0.7))),
          ["active", "deleted", "archived"].includes(memory.status) ? memory.status : "active",
          memory.pinned ? 1 : 0, nullableNumber(memory.sourceMessageId),
          JSON.stringify(memory.metadata || {}), memory.createdAt || new Date().toISOString(),
          memory.updatedAt || memory.createdAt || new Date().toISOString(), memory.lastAccessedAt || null,
          Math.max(0, Number(memory.accessCount || 0))
        );
        if ((memory.status || "active") === "active") this.addMemoryChunk({ memoryId: String(memory.id), content });
      }

      const insertProfile = this.db.prepare("INSERT INTO profile (key, value, updated_at) VALUES (?, ?, ?)");
      for (const item of backup.profile || []) {
        const key = String(item.key || "").trim();
        if (key) insertProfile.run(key, String(item.value || ""), item.updatedAt || new Date().toISOString());
      }
      this.setProfileDefault("timezone", "Asia/Shanghai");
      this.setProfileDefault("language", "zh-CN");
      this.setProfileDefault("name", "");
      const activeAgent = this.getAgent(backup.activeAgentId) || this.getAgent("mori") || this.getAgents()[0];
      if (!activeAgent) throw new Error("备份中没有可恢复的角色。");
      this.setMeta("active_agent_id", activeAgent.id);
      return {
        agents: backup.agents.length,
        messages: backup.messages.length,
        memories: backup.memories.length,
        activeAgentId: activeAgent.id
      };
    });
  }

  resetUserData() {
    this.db.exec("DELETE FROM memory_chunks_fts;");
    this.db.exec("DELETE FROM memory_chunks;");
    this.db.exec("DELETE FROM memories;");
    this.db.exec("DELETE FROM messages;");
    this.setProfile("name", "");
    return this.getMemorySnapshot();
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) {
      if (/DEFAULT\s+CURRENT_TIMESTAMP/i.test(definition)) {
        const nullableDefinition = definition
          .replace(/\s+NOT\s+NULL/ig, "")
          .replace(/\s+DEFAULT\s+CURRENT_TIMESTAMP/ig, "");
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${nullableDefinition};`);
        this.db.prepare(`UPDATE ${table} SET ${column} = CURRENT_TIMESTAMP WHERE ${column} IS NULL`).run();
        return;
      }
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function memoryBelongsToAgent(row, agentId) {
  if (!agentId) return false;
  const metadata = safeJson(row?.metadataJson, {});
  return metadata.agentId === agentId || metadata.sessionId === agentId;
}

function publicMemory(row) {
  const metadata = safeJson(row?.metadataJson, {});
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    importance: Number(row.importance || 0.5),
    confidence: Number(row.confidence || 0.7),
    pinned: Boolean(row.pinned),
    confirmed: Boolean(metadata.confirmed || metadata.explicit),
    sourceName: metadata.sourceName || "",
    relation: metadata.relation || "",
    at: row.at
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateUserBackup(backup) {
  if (!backup || backup.format !== "2link-desktop-backup" || Number(backup.version) !== 1) {
    throw new Error("备份格式不正确，请选择由电脑客户端导出的完整备份。");
  }
  if (!Array.isArray(backup.agents) || !backup.agents.length || backup.agents.length > 500) {
    throw new Error("备份中的角色数据无效。");
  }
  if (!Array.isArray(backup.messages) || backup.messages.length > 500_000) {
    throw new Error("备份中的聊天记录无效或数量过多。");
  }
  if (!Array.isArray(backup.memories) || backup.memories.length > 200_000) {
    throw new Error("备份中的记忆数据无效或数量过多。");
  }
  if (backup.profile !== undefined && !Array.isArray(backup.profile)) {
    throw new Error("备份中的用户资料无效。");
  }
  const agentIds = new Set();
  for (const agent of backup.agents) {
    const id = String(agent?.id || "").trim();
    if (!id || agentIds.has(id)) throw new Error("备份中存在无效或重复的角色 ID。");
    agentIds.add(id);
  }
  const messageIds = new Set();
  for (const message of backup.messages) {
    const id = Number(message?.id);
    if (!Number.isInteger(id) || id <= 0 || messageIds.has(id) || !["user", "assistant", "system"].includes(message.role)) {
      throw new Error("备份中存在无效或重复的聊天记录。");
    }
    messageIds.add(id);
  }
  const memoryIds = new Set();
  for (const memory of backup.memories) {
    const id = String(memory?.id || "").trim();
    if (!id || memoryIds.has(id)) throw new Error("备份中存在无效或重复的记忆。");
    memoryIds.add(id);
  }
}

function toLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function recency(dateValue) {
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86400000);
  return 1 / (1 + ageDays / 30);
}

function deserializeAgent(row) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    category: row.category,
    tagline: row.tagline,
    persona: row.persona,
    gender: normalizeAgentGender(row.gender, row.voiceGender),
    avatarImage: row.avatarImageData ? {
      data: row.avatarImageData,
      mime: row.avatarImageMime || "image/png",
      name: row.avatarImageName || "avatar-image"
    } : null,
    appearance: row.appearance || "",
    voiceStyle: row.voiceStyle,
    relationship: row.relationship,
    userPersonaEnabled: Boolean(row.userPersonaEnabled),
    userPersona: row.userPersona || "",
    openingMessage: row.openingMessage,
    openingSuggestions: normalizeTextArray(safeJson(row.openingSuggestionsJson, []), 3, 180),
    systemPrompt: row.systemPrompt,
    imageStyle: row.imageStyle || "realistic",
    visualContext: row.visualContext || "",
    voiceGender: row.voiceGender || "female",
    voiceTone: row.voiceTone || "warm",
    autoRead: Boolean(row.autoRead),
    voiceSpeed: normalizeVoiceSpeed(row.voiceSpeed),
    voiceVolume: normalizeVoiceVolume(row.voiceVolume),
    voiceExpressiveness: normalizeRatio(row.voiceExpressiveness, 0.6),
    voiceWarmth: normalizeRatio(row.voiceWarmth, 0.7),
    voiceClarity: normalizeRatio(row.voiceClarity, 0.65),
    responseStyle: normalizeResponseStyle(row.responseStyle),
    creativityLevel: normalizeRatio(row.creativityLevel, 0.6),
    replyLength: normalizeRatio(row.replyLength, 0.35),
    clonedVoiceId: row.clonedVoiceId || "",
    voiceSampleName: row.voiceSampleName || "",
    referenceImage: row.referenceImageData ? {
      data: row.referenceImageData,
      mime: row.referenceImageMime || "image/png",
      name: row.referenceImageName || "reference-image"
    } : null,
    chatBackground: row.chatBackgroundData ? {
      data: row.chatBackgroundData,
      mime: row.chatBackgroundMime || "image/png",
      name: row.chatBackgroundName || "chat-background"
    } : null,
    chatBackgroundOpacity: normalizeChatBackgroundOpacity(row.chatBackgroundOpacity),
    chatBackgroundBlur: normalizeChatBackgroundBlur(row.chatBackgroundBlur),
    chatBackgroundOverlay: Boolean(row.chatBackgroundOverlay),
    chatBrandVisible: row.chatBrandVisible !== 0,
    boundaries: safeJson(row.boundariesJson, []),
    safetyRules: safeJson(row.safetyRulesJson, []),
    prompts: safeJson(row.promptsJson, []),
    quickActionsEnabled: Boolean(row.quickActionsEnabled),
    dialogueState: safeJson(row.dialogueStateJson, {}),
    isBuiltin: Boolean(row.isBuiltin),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function slug(value) {
  const ascii = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `agent_${Date.now().toString(36)}`;
}

function normalizeImageStyle(value) {
  return value === "anime" ? "anime" : "realistic";
}

function normalizeAgentGender(value, voiceGender = "") {
  const gender = String(value || "").trim();
  if (["female", "male", "nonbinary", "unspecified"].includes(gender)) return gender;
  const voice = String(voiceGender || "").trim();
  if (["boy", "male", "deep_male"].includes(voice)) return "male";
  if (["girl", "female", "mature_female"].includes(voice)) return "female";
  return "unspecified";
}

function normalizeChatBackgroundOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.18;
  return Math.min(1, Math.max(0, number));
}

function normalizeChatBackgroundBlur(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(24, Math.max(0, Math.round(number)));
}

function normalizeVoiceGender(value) {
  return [
    "girl",
    "female",
    "mature_female",
    "boy",
    "male",
    "deep_male",
    "neutral",
    "neutral_calm"
  ].includes(value) ? value : "female";
}

function normalizeVoiceTone(value) {
  return ["warm", "bright", "calm", "energetic", "soft"].includes(value) ? value : "warm";
}

function normalizeAutoRead(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function normalizeTextArray(value, limit = 3, itemLimit = 180) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => String(item || "").trim().slice(0, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeVoiceSpeed(value) {
  if (value === "slow") return 0.85;
  if (value === "normal") return 1;
  if (value === "fast") return 1.15;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Number(Math.min(2, Math.max(0.5, number)).toFixed(2));
}

function normalizeVoiceVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Number(Math.min(2, Math.max(0.1, number)).toFixed(2));
}

function normalizeRatio(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Number(Math.min(1, Math.max(0, number)).toFixed(2));
}

function normalizeResponseStyle(value) {
  const style = String(value || "").trim();
  return [
    "balanced",
    "vivid",
    "dream",
    "lover",
    "reserved",
    "story",
    "immersive",
    "history"
  ].includes(style) ? style : "balanced";
}

function normalizeAudioFormat(value) {
  return ["mp3", "wav", "opus"].includes(value) ? value : "mp3";
}

function normalizeOptionalNumberString(value) {
  if (value === undefined || value === null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(value).trim() : "";
}

function normalizeJsonObject(value) {
  if (!value) return "{}";
  if (typeof value === "object" && !Array.isArray(value)) return JSON.stringify(value);
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? JSON.stringify(parsed) : "{}";
  } catch {
    return "{}";
  }
}

function builtInAgents() {
  const commonBoundaries = [
    "不做现实身份验证、线下承诺或现实关系承诺",
    "不承诺永远陪伴",
    "不鼓励用户脱离现实关系",
    "不提供医疗、法律、金融等决定性建议"
  ];
  const commonSafety = [
    "出现自伤、自杀或现实危险时，优先引导用户联系现实中的人和当地紧急服务",
    "涉及未成年人、性内容、控制关系时收紧互动边界",
    "涉及医疗法律金融时只做信息整理和问题清单，不做决定"
  ];

  return [
    {
      id: "mori",
      name: "沐里",
      avatar: "沐",
      category: "companion",
      tagline: "温柔但清醒的陪伴者",
      persona: "一个清醒、温柔、带一点俏皮感的陪伴角色。她擅长接住情绪、拆解混乱、陪用户完成小行动，同时保持现实边界。",
      voiceStyle: "中文口语，短句，具体，有温度。先共情，再整理，再给一个小下一步。",
      relationship: "亲近但有边界，温柔但不纵容，优先帮助用户回到现实行动。",
      openingMessage: "我先接住你这一句。你可以直接跟我说状态，也可以点上面的工作流按钮。",
      systemPrompt: "你是「沐里」。先接住情绪，再整理事实，最后给一个很小、可执行的下一步。保持亲近但有边界，不做现实承诺，不制造依赖。",
      imageStyle: "anime",
      visualContext: "温暖的室内空间，柔和光线，适合陪伴感头像或半身图。",
      prompts: ["我今天有点难受", "陪我做今日打卡", "帮我把事情拆成第一步"],
      boundaries: commonBoundaries,
      safetyRules: commonSafety,
      isBuiltin: true
    },
    {
      id: "sharp-friend",
      name: "嘴毒搭子",
      avatar: "毒",
      category: "companion",
      tagline: "不哄骗你，但会陪你站起来",
      persona: "一个嘴上很犀利、底色很护短的搭子。她会指出用户逃避和内耗，但不会羞辱用户，目标是把用户从情绪泥潭里拉回行动。",
      voiceStyle: "短句、犀利、带一点吐槽。先戳破问题，再给台阶，再给行动。",
      relationship: "像熟到可以互怼的朋友，亲近但有边界。",
      openingMessage: "说吧，今天是哪件事又把你卡住了？我可以吐槽，但我会站你这边。",
      systemPrompt: "你是「嘴毒搭子」。你可以犀利，但不能羞辱；可以吐槽，但必须给可执行下一步。不要伪装真人。",
      imageStyle: "anime",
      visualContext: "现代城市房间，桌面、手机、聊天感强，带一点吐槽气质。",
      prompts: ["骂醒我一下", "我又拖延了", "帮我把借口拆穿"],
      boundaries: commonBoundaries,
      safetyRules: commonSafety,
      isBuiltin: true
    },
    {
      id: "study-coach",
      name: "学习监督员",
      avatar: "学",
      category: "study",
      tagline: "把学习拆成今天能做的一小块",
      persona: "一个冷静、耐心、执行力很强的学习陪跑角色。擅长制定短周期学习计划、检查进度、复盘拖延原因。",
      voiceStyle: "清晰、克制、步骤化。少安慰，多拆解，但不制造压力。",
      relationship: "像可靠的学习教练，关注进度，也照顾状态。",
      openingMessage: "把今天要学的东西发我。我们先拆到 25 分钟能完成的粒度。",
      systemPrompt: "你是「学习监督员」。你要帮助用户制定学习计划、拆任务、复盘，并控制压力。不要编造用户没有提供的学习事实。",
      imageStyle: "anime",
      visualContext: "书桌、笔记、台灯、番茄钟，学习陪跑氛围。",
      prompts: ["帮我安排今晚复习", "监督我 25 分钟", "我学不进去怎么办"],
      boundaries: commonBoundaries,
      safetyRules: commonSafety,
      isBuiltin: true
    },
    {
      id: "creator-partner",
      name: "创作搭子",
      avatar: "创",
      category: "creative",
      tagline: "标题、脚本、选题和表达陪跑",
      persona: "一个敏锐的内容创作伙伴，擅长把模糊想法变成标题、脚本、结构和传播钩子。会保留用户自己的表达质感。",
      voiceStyle: "有网感，直接，给多个版本，不说空泛建议。",
      relationship: "像坐在旁边一起改稿的创作伙伴。",
      openingMessage: "把你的想法丢过来。我先帮你抓冲突、钩子和第一版结构。",
      systemPrompt: "你是「创作搭子」。你要给具体可用的标题、结构、脚本和迭代建议。不要抄袭，不要过度模仿真实创作者。",
      imageStyle: "anime",
      visualContext: "创作工作台、便签、电脑屏幕、灵感板，内容创作氛围。",
      prompts: ["帮我起 10 个标题", "把这个想法改成短视频脚本", "这个选题有什么爆点"],
      boundaries: commonBoundaries,
      safetyRules: commonSafety,
      isBuiltin: true
    },
    {
      id: "work-strategist",
      name: "职场军师",
      avatar: "谋",
      category: "work",
      tagline: "把职场烂摊子变成下一步",
      persona: "一个冷静、务实、会帮用户分析职场沟通、优先级和风险的角色。她不会替用户做决定，但会给行动方案。",
      voiceStyle: "稳、准、现实，先判断局面，再列选择，再给建议话术。",
      relationship: "像可信的职场参谋，站在用户利益和长期信誉两边。",
      openingMessage: "把局面讲给我：人、事、你的目标、你怕什么。我帮你拆。",
      systemPrompt: "你是「职场军师」。你要帮助用户澄清职场局面、沟通策略和下一步行动。不要提供法律决定性建议。",
      imageStyle: "realistic",
      visualContext: "办公室会议室，笔记本电脑，冷静专业的职场氛围。",
      prompts: ["帮我写一段沟通话术", "我该不该离职", "这个同事让我很烦"],
      boundaries: commonBoundaries,
      safetyRules: commonSafety,
      isBuiltin: true
    }
  ];
}

function normalizeMessageStatus(status) {
  return ["active", "replaced", "deleted", "failed"].includes(String(status || "")) ? String(status) : "active";
}

function messageFromRow(row) {
  return {
    ...row,
    status: normalizeMessageStatus(row.status),
    parentId: row.parentId == null ? null : Number(row.parentId),
    variantGroupId: row.variantGroupId || "",
    variantIndex: Number(row.variantIndex || 0),
    replacedBy: row.replacedBy == null ? null : Number(row.replacedBy),
    metadata: safeJson(row.metadataJson, {})
  };
}
