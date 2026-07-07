import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildFtsQuery, cosineSimilarity, embedText, searchableText } from "./rag.js";

export class CompanionStore {
  constructor(dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.enableWalMode();
    this.db.exec("PRAGMA foreign_keys = ON;");
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
        opening_message TEXT NOT NULL DEFAULT '',
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
        appearance TEXT NOT NULL DEFAULT '',
        voice_style TEXT NOT NULL DEFAULT '',
        relationship TEXT NOT NULL DEFAULT '',
        opening_message TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        voice_gender TEXT NOT NULL DEFAULT 'female',
        voice_tone TEXT NOT NULL DEFAULT 'warm',
        cloned_voice_id TEXT NOT NULL DEFAULT '',
        voice_sample_name TEXT NOT NULL DEFAULT '',
        reference_image_data TEXT NOT NULL DEFAULT '',
        reference_image_mime TEXT NOT NULL DEFAULT '',
        reference_image_name TEXT NOT NULL DEFAULT '',
        boundaries_json TEXT NOT NULL DEFAULT '[]',
        safety_rules_json TEXT NOT NULL DEFAULT '[]',
        prompts_json TEXT NOT NULL DEFAULT '[]',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        mood TEXT,
        workflow TEXT,
        safety_level TEXT,
        source TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        compressed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

      CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_compression ON messages(session_id, compressed_at, id);
      CREATE INDEX IF NOT EXISTS idx_memories_kind_status ON memories(kind, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chunks_memory ON memory_chunks(memory_id);
      CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category, updated_at DESC);
    `);

    this.ensureColumn("messages", "compressed_at", "TEXT");
    this.ensureColumn("messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("agents", "image_style", "TEXT NOT NULL DEFAULT 'realistic'");
    this.ensureColumn("agents", "appearance", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "visual_context", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "voice_gender", "TEXT NOT NULL DEFAULT 'female'");
    this.ensureColumn("agents", "voice_tone", "TEXT NOT NULL DEFAULT 'warm'");
    this.ensureColumn("agents", "cloned_voice_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "voice_sample_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "reference_image_data", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "reference_image_mime", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "reference_image_name", "TEXT NOT NULL DEFAULT ''");
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

    this.db.prepare(`
      INSERT INTO meta (key, value)
      VALUES ('schema_version', '2')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();

    this.setProfileDefault("timezone", "Asia/Shanghai");
    this.setProfileDefault("language", "zh-CN");
    this.setProfileDefault("name", "");
    this.db.prepare("INSERT OR IGNORE INTO model_config (id) VALUES (1)").run();
    this.db.prepare("INSERT OR IGNORE INTO agent_config (id) VALUES (1)").run();
    this.seedBuiltInAgents();
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
      SELECT id, name, avatar, category, tagline, persona, is_builtin AS isBuiltin, updated_at AS updatedAt
      FROM agents
      ORDER BY is_builtin DESC, updated_at DESC
    `).all();
  }

  getAgent(id) {
    const row = this.db.prepare(`
      SELECT
        id, name, avatar, category, tagline, persona, appearance,
        voice_style AS voiceStyle,
        relationship,
        opening_message AS openingMessage,
        system_prompt AS systemPrompt,
        image_style AS imageStyle,
        visual_context AS visualContext,
        voice_gender AS voiceGender,
        voice_tone AS voiceTone,
        cloned_voice_id AS clonedVoiceId,
        voice_sample_name AS voiceSampleName,
        reference_image_data AS referenceImageData,
        reference_image_mime AS referenceImageMime,
        reference_image_name AS referenceImageName,
        boundaries_json AS boundariesJson,
        safety_rules_json AS safetyRulesJson,
        prompts_json AS promptsJson,
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
        id, name, avatar, category, tagline, persona, appearance, voice_style, relationship,
        opening_message, system_prompt, image_style, visual_context,
        voice_gender, voice_tone, cloned_voice_id, voice_sample_name,
        reference_image_data, reference_image_mime, reference_image_name,
        boundaries_json, safety_rules_json,
        prompts_json, is_builtin, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar = excluded.avatar,
        category = excluded.category,
        tagline = excluded.tagline,
        persona = excluded.persona,
        appearance = excluded.appearance,
        voice_style = excluded.voice_style,
        relationship = excluded.relationship,
        opening_message = excluded.opening_message,
        system_prompt = excluded.system_prompt,
        image_style = excluded.image_style,
        visual_context = excluded.visual_context,
        voice_gender = excluded.voice_gender,
        voice_tone = excluded.voice_tone,
        cloned_voice_id = excluded.cloned_voice_id,
        voice_sample_name = excluded.voice_sample_name,
        reference_image_data = excluded.reference_image_data,
        reference_image_mime = excluded.reference_image_mime,
        reference_image_name = excluded.reference_image_name,
        boundaries_json = excluded.boundaries_json,
        safety_rules_json = excluded.safety_rules_json,
        prompts_json = excluded.prompts_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      String(agent.name || "未命名角色").trim(),
      String(agent.avatar || "").trim(),
      String(agent.category || "custom").trim(),
      String(agent.tagline || "").trim(),
      String(agent.persona || "").trim(),
      String(agent.appearance || "").trim(),
      String(agent.voiceStyle || "").trim(),
      String(agent.relationship || "").trim(),
      String(agent.openingMessage || "").trim(),
      String(agent.systemPrompt || "").trim(),
      normalizeImageStyle(agent.imageStyle),
      String(agent.visualContext || "").trim(),
      normalizeVoiceGender(agent.voiceGender),
      normalizeVoiceTone(agent.voiceTone),
      String(agent.clonedVoiceId || "").trim(),
      String(agent.voiceSampleName || "").trim(),
      agent.clearReferenceImage ? "" : String(agent.referenceImage?.data || agent.referenceImageData || "").trim(),
      agent.clearReferenceImage ? "" : String(agent.referenceImage?.mime || agent.referenceImageMime || "").trim(),
      agent.clearReferenceImage ? "" : String(agent.referenceImage?.name || agent.referenceImageName || "").trim(),
      JSON.stringify(toLines(agent.boundaries)),
      JSON.stringify(toLines(agent.safetyRules)),
      JSON.stringify(Array.isArray(agent.prompts) ? agent.prompts : []),
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
    if (this.getActiveAgentId() === id) this.setMeta("active_agent_id", "mori");
    return true;
  }

  addMessage({ sessionId = "default", role, content, mood = null, workflow = null, safetyLevel = null, source = null, metadata = {} }) {
    const result = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, mood, workflow, safety_level, source, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, role, content, mood, workflow, safetyLevel, source, JSON.stringify(metadata || {}));
    return Number(result.lastInsertRowid);
  }

  getMessage(id) {
    const row = this.db.prepare(`
      SELECT
        id, role, content, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt
      FROM messages
      WHERE id = ?
      LIMIT 1
    `).get(Number(id));
    return row ? { ...row, metadata: safeJson(row.metadataJson, {}) } : null;
  }

  getRecentMessages(sessionId = "default", limit = 16) {
    const rows = this.db.prepare(`
      SELECT
        id, role, content, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt
      FROM messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, limit).reverse();
    return rows.map((row) => ({ ...row, metadata: safeJson(row.metadataJson, {}) }));
  }

  getMessagesBefore({ sessionId = "default", beforeId, limit = 30 }) {
    const rows = this.db.prepare(`
      SELECT
        id, role, content, mood, workflow, safety_level AS safetyLevel,
        source, metadata_json AS metadataJson, created_at AS createdAt
      FROM messages
      WHERE session_id = ? AND id < ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, Number(beforeId), Number(limit)).reverse();
    return rows.map((row) => ({ ...row, metadata: safeJson(row.metadataJson, {}) }));
  }

  deleteRecentAssistantTextMessage({ sessionId = "default", content, withinLast = 6 }) {
    const clean = String(content || "").trim();
    if (!clean) return 0;
    const rows = this.db.prepare(`
      SELECT id, content, metadata_json AS metadataJson
      FROM messages
      WHERE session_id = ?
        AND role = 'assistant'
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

  getUncompressedMessageCount(sessionId = "default") {
    const row = this.db.prepare(`
      SELECT count(*) AS count
      FROM messages
      WHERE session_id = ? AND compressed_at IS NULL
    `).get(sessionId);
    return Number(row?.count || 0);
  }

  getOldestUncompressedMessages(sessionId = "default", limit = 100) {
    return this.db.prepare(`
      SELECT id, role, content, mood, workflow, safety_level AS safetyLevel, created_at AS createdAt
      FROM messages
      WHERE session_id = ? AND compressed_at IS NULL
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
      SELECT id, kind, content AS text, importance, confidence, metadata_json AS metadataJson, updated_at AS at
      FROM memories
      WHERE status = 'active'
        AND (? = '' OR json_extract(metadata_json, '$.agentId') = ? OR json_extract(metadata_json, '$.sessionId') = ?)
      ORDER BY pinned DESC, importance DESC, updated_at DESC
      LIMIT 100
    `).all(agentFilter, agentFilter, agentFilter);

    const byKind = (kind) => rows
      .filter((row) => row.kind === kind)
      .slice(0, perKind)
      .map(({ id, text, importance, confidence, at }) => ({ id, text, importance, confidence, at }));

    return {
      profile,
      facts: byKind("fact"),
      preferences: byKind("preference"),
      emotional_patterns: byKind("emotional_pattern"),
      persona_style: byKind("persona_style"),
      persona_values: byKind("persona_value"),
      persona_catchphrases: byKind("persona_catchphrase"),
      persona_corpus: byKind("persona_corpus"),
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
    appearance: row.appearance || "",
    voiceStyle: row.voiceStyle,
    relationship: row.relationship,
    openingMessage: row.openingMessage,
    systemPrompt: row.systemPrompt,
    imageStyle: row.imageStyle || "realistic",
    visualContext: row.visualContext || "",
    voiceGender: row.voiceGender || "female",
    voiceTone: row.voiceTone || "warm",
    clonedVoiceId: row.clonedVoiceId || "",
    voiceSampleName: row.voiceSampleName || "",
    referenceImage: row.referenceImageData ? {
      data: row.referenceImageData,
      mime: row.referenceImageMime || "image/png",
      name: row.referenceImageName || "reference-image"
    } : null,
    boundaries: safeJson(row.boundariesJson, []),
    safetyRules: safeJson(row.safetyRulesJson, []),
    prompts: safeJson(row.promptsJson, []),
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
