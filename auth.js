// Fix fetch for Node.js (Replit compatible)
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { getDb, backupDb } = require("./database");

// Exchange code for access + refresh tokens
async function exchangeCode(code) {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.REDIRECT_URI,
    }),
  });

  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

// Refresh an expired token
async function refreshToken(refreshToken) {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json();
}

// Get user info
async function getUserInfo(accessToken) {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`Fetching user info failed: ${await res.text()}`);
  return res.json();
}

// Save user to DB
function saveUser(userId, accessToken, refreshToken, expiresIn) {
  const db = getDb();
  const expiresAt = Date.now() + expiresIn * 1000;

  db.prepare(`
    INSERT OR REPLACE INTO users (id, access_token, refresh_token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, accessToken, refreshToken, expiresAt);

  console.log(`💾 Saved user ${userId} to DB`);

  // Backup immediately after adding a new user
  backupDb();
}

// Get all users
function getAllUsers() {
  const db = getDb();
  return db.prepare("SELECT * FROM users").all();
}

// ❌ Remove user from DB
function removeUser(userId) {
  const db = getDb();
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  console.log(`🗑️ Removed user ${userId} from DB`);

  // Optional: backup after deletion too
  backupDb();
}

// Export all functions
module.exports = {
  exchangeCode,
  refreshToken,
  getUserInfo,
  saveUser,
  getAllUsers,
  removeUser, // ✅ now exported
};
