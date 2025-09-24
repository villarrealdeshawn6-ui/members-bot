const fs = require("fs");
const { Octokit } = require("@octokit/rest");
const Database = require("better-sqlite3");

const dbPath = "./users.db";
const blacklistPath = "./blacklist.json";
let db = null;

// GitHub config
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_USERNAME;
const repo = process.env.GITHUB_REPO;
const branch = "main";

// --- Database functions ---
function initDatabase() {
  // Ensure DB file exists
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "");

  // Open DB
  db = new Database(dbPath);

  // Ensure 'users' table exists
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER
    )
  `).run();

  console.log("✅ SQLite DB initialized and 'users' table ensured");
  return db;
}

function getDb() {
  if (!db) initDatabase();
  return db;
}

// --- GitHub sync functions ---
async function restoreDb() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_USERNAME || !process.env.GITHUB_REPO) {
    console.log("⚠️ GitHub sync not configured, initializing local DB only");
    initDatabase();
    ensureLocalBlacklist();
    return;
  }

  try {
    const { data: file } = await octokit.repos.getContent({
      owner,
      repo,
      path: "users.db",
      ref: branch,
    });

    const content = Buffer.from(file.content, "base64");
    fs.writeFileSync(dbPath, content);
    console.log("✅ SQLite DB restored from GitHub");
  } catch {
    console.log("📂 No DB found on GitHub, starting fresh");
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "");
  }

  try {
    const { data: file } = await octokit.repos.getContent({
      owner,
      repo,
      path: "blacklist.json",
      ref: branch,
    });

    const content = Buffer.from(file.content, "base64");
    fs.writeFileSync(blacklistPath, content);
    console.log("✅ blacklist.json restored from GitHub");
  } catch {
    console.log("📂 No blacklist.json found on GitHub, creating new one");
    ensureLocalBlacklist();
  }

  // Ensure DB table exists after restore
  initDatabase();
}

// Ensure blacklist.json exists
function ensureLocalBlacklist() {
  if (!fs.existsSync(blacklistPath)) {
    fs.writeFileSync(blacklistPath, "[]");
    console.log("📄 Created local blacklist.json");
  }
}

// Backup users.db and blacklist.json
async function backupDb() {
  if (!fs.existsSync(dbPath)) {
    console.log("📂 No local DB to backup");
    return;
  }

  // --- users.db ---
  const dbContent = fs.readFileSync(dbPath);
  let dbSha;

  try {
    const { data: file } = await octokit.repos.getContent({
      owner,
      repo,
      path: "users.db",
      ref: branch,
    });
    dbSha = file.sha;
  } catch {
    console.log("📂 users.db not found in repo, will create new one.");
  }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "users.db",
      message: "Auto-backup SQLite DB",
      content: dbContent.toString("base64"),
      sha: dbSha,
      branch,
    });
  } catch (err) {
    console.error("❌ Failed to back up users.db:", err);
  }

  // --- blacklist.json ---
  ensureLocalBlacklist(); // make sure file exists
  const blContent = fs.readFileSync(blacklistPath);
  let blSha;

  try {
    const { data: file } = await octokit.repos.getContent({
      owner,
      repo,
      path: "blacklist.json",
      ref: branch,
    });
    blSha = file.sha;
  } catch {
    console.log("📂 blacklist.json not found in repo, will create new one.");
  }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "blacklist.json",
      message: "Auto-backup blacklist.json",
      content: blContent.toString("base64"),
      sha: blSha,
      branch,
    });
  } catch (err) {
    console.error("❌ Failed to back up blacklist.json:", err);
  }
}

async function initializeSync() {
  await restoreDb();

  // Backup every 1 minute
  setInterval(backupDb, 1000 * 60 * 1);
  console.log("🔄 GitHub backup scheduled every 1 minute");
}

module.exports = {
  initDatabase,
  getDb,
  restoreDb,
  backupDb,
  initializeSync,
  ensureLocalBlacklist,
};
