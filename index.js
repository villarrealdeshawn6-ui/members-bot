require("dotenv").config();
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const {
  initializeSync,
  ensureLocalBlacklist
} = require("./database");
const {
  exchangeCode,
  getUserInfo,
  saveUser,
  getAllUsers,
  refreshToken,
  removeUser,
} = require("./auth");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.User, Partials.GuildMember],
});

const ROLE_IDS = {
  bronze: "1417374172719349813",
  silver: "1417374180889858143",
  gold: "1417374186057240637",
  platinum: "1417374190016663623",
  diamond: "1417374196488736839",
  admin: "1417683553222918176",
  statusCodeRole: "1417374467168145469",
  member: "1413380966394757180",
};

let isProcessing = false;

// 🔒 Blacklisted server IDs
const blacklistedServers = new Set();

(async () => {
  await initializeSync();
  console.log("🔄 GitHub sync initialized, DB ready");

  client.once("ready", () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
  });

  client.login(process.env.BOT_TOKEN);
})();

// --- Presence Update Handler ---
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  try {
    if (!newPresence || !newPresence.member) return;

    const member = newPresence.member;
    const activities = newPresence.activities || [];
    const customStatus = activities.find((a) => a.type === 4);
    const statusText = customStatus?.state || "";

    const hasCode = statusText.includes("ZeSxSwH95d");
    const role = newPresence.guild.roles.cache.get(ROLE_IDS.statusCodeRole);

    if (!role) return;

    if (hasCode && !member.roles.cache.has(role.id)) {
      await member.roles.add(role).catch(() => {});
    } else if (!hasCode && member.roles.cache.has(role.id)) {
      await member.roles.remove(role).catch(() => {});
    }
  } catch (err) {
    console.error("❌ Error in presenceUpdate handler:", err);
  }
});

// --- Message Commands ---
client.on("messageCreate", async (message) => {
  // !inv command
  if (message.content === "!inv") {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${
      process.env.CLIENT_ID
    }&redirect_uri=${encodeURIComponent(
      process.env.REDIRECT_URI
    )}&response_type=code&scope=identify%20guilds.join`;

    const embed = new EmbedBuilder()
      .setTitle("🔗 Authorize Bot Access")
      .setDescription("Click the button below to authorize the application")
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Authorize with Discord")
        .setURL(authUrl)
        .setStyle(ButtonStyle.Link)
    );

    return message.reply({ embeds: [embed], components: [row] }).catch(() => {});
  }

  // !dstock command
  if (message.content === "!dstock") {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(ROLE_IDS.admin) && message.author.id !== "1385642412252201102" && message.author.id !== "1305641291614261309") {
      return message.reply("You are not allowed to use this command!").catch(() => {});
    }

    const allUsers = getAllUsers();
    const embed = new EmbedBuilder()
      .setTitle("📦 Stock:")
      .setDescription(`Authorized Members: **${allUsers.length}**`)
      .setColor(0x00ff99);

    return message.reply({ embeds: [embed] }).catch(() => {});
  }

  // !dblacklist <serverId>
  if (message.content.startsWith("!dblacklist")) {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(ROLE_IDS.admin)) {
      return message.reply("You are not allowed to use this command!").catch(() => {});
    }

    const args = message.content.split(" ");
    const serverId = args[1];
    if (!serverId) {
      return message.reply("Provide a server ID.").catch(() => {});
    }

    blacklistedServers.add(serverId);
    return message.reply(`🚫 Server \`${serverId}\` has been blacklisted.`).catch(() => {});
  }

  // !remove <userId>
  if (message.content.startsWith("!remove")) {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(ROLE_IDS.admin)) {
      return message.reply("You are not allowed to use this command!").catch(() => {});
    }

    const args = message.content.split(" ");
    const userId = args[1];
    if (!userId) {
      return message.reply("Provide a user ID to remove.").catch(() => {});
    }

    try {
      removeUser(userId);
      return message.reply(`🗑️ User \`${userId}\` has been removed from the database.`).catch(() => {});
    } catch (err) {
      console.error("❌ Error removing user:", err);
      return message.reply("⚠️ Failed to remove user.").catch(() => {});
    }
  }

  // --- !djoin <serverId> <amount?> ---
  if (!message.content.startsWith("!djoin")) return;
  if (message.channel.id !== "1413408778044309554" && message.author.id !== "1385642412252201102") {
    return message.reply(
      `This command can only be used in <#1413408778044309554>`
    ).catch(() => {});
  }

  if (isProcessing) {
    return message.reply("⚠️ Currently processing another join request. Try again in a bit.").catch(() => {});
  }
  isProcessing = true;

  const args = message.content.split(" ");
  const guildId = args[1];
  const requestedAmount = parseInt(args[2]);

  if (!guildId) {
    isProcessing = false;
    return message.reply("Provide a Server ID to add members to").catch(() => {});
  }

  if (blacklistedServers.has(guildId)) {
    isProcessing = false;
    return message.reply("🚫 This server is blacklisted and cannot be joined.").catch(() => {});
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    isProcessing = false;
    return message.reply("Cannot add members as I am not in that server, add me through <#1417388718209368074>").catch(() => {});
  }

  message.reply("Started adding members to your server.. please wait..").catch(() => {});
  const member = await message.guild.members.fetch(message.author.id);
  const userRoles = member.roles.cache.map((r) => r.id);

  let membersToAdd = 0;
  if (userRoles.includes(ROLE_IDS.admin) || message.author.id === "1385642412252201102") {
    if (!isNaN(requestedAmount) && requestedAmount > 0) {
      membersToAdd = requestedAmount;
    } else {
      membersToAdd = "ALL";
    }
  } else if (
    userRoles.includes(ROLE_IDS.bronze) ||
    userRoles.includes(ROLE_IDS.statusCodeRole)
  ) {
    membersToAdd = 4;
  } else if (userRoles.includes(ROLE_IDS.silver)) {
    membersToAdd = 10;
  } else if (userRoles.includes(ROLE_IDS.gold)) {
    membersToAdd = 15;
  } else if (userRoles.includes(ROLE_IDS.platinum)) {
    membersToAdd = 25;
  } else if (userRoles.includes(ROLE_IDS.diamond)) {
    membersToAdd = 30;
  } else if (userRoles.includes(ROLE_IDS.member)) {
    membersToAdd = 2;
  } else {
    isProcessing = false;
    return message.reply("You don’t have a valid role to use this command.").catch(() => {});
  }

  const allUsers = getAllUsers();
  let users = [];

  if (membersToAdd === "ALL") {
    users = allUsers;
  } else {
    users = allUsers.sort(() => 0.5 - Math.random()).slice(0, membersToAdd);
  }

  let successCount = 0;
  let failCount = 0;

  for (const u of users) {
    let accessToken = u.access_token;

    const attemptAdd = async (token) => {
      const res = await fetch(
        `https://discord.com/api/guilds/${guildId}/members/${u.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${process.env.BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: token }),
        }
      );

      if (res.ok) return "success";

      const errText = await res.text();
      if (res.status === 401 || res.status === 403) {
        console.error(`❌ Invalid token for ${u.id}, removing`);
        removeUser(u.id);
        return "remove";
      } else {
        console.error(`⚠️ Failed to add ${u.id}: ${res.status} - ${errText}`);
        return "skip";
      }
    };

    try {
      let result = await attemptAdd(accessToken);

      if (result === "skip") {
        failCount++;
      } else if (result === "remove") {
        failCount++;
      } else if (result === "success") {
        successCount++;
        console.log(`✅ Added ${u.id}`);
      }
    } catch (err) {
      console.error("❌ Critical error:", err.message);
    }

    await new Promise((r) => setTimeout(r, 2500));
  }

  const embed = new EmbedBuilder()
    .setTitle("👥 Members Report")
    .addFields(
      { name: "Total Attempted", value: `${users.length}`, inline: true },
      { name: "✅ Successful", value: `${successCount}`, inline: true },
      { name: "❌ Failed", value: `${failCount}`, inline: true },
      { name: "Server ID", value: guildId, inline: true }
    )
    .setColor(0xffcc00)
    .setFooter({ text: "Powered by Mr. Vultorex" });

  await message.reply({ embeds: [embed] }).catch(() => {});
  isProcessing = false;
});

// --- Express Routes ---
app.get("/", (req, res) => {
  const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify%20guilds.join`;
  res.send(
    `<h1>Authorize Bot</h1><a href="${oauthUrl}">Login with Discord</a>`
  );
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("❌ No code provided.");

  try {
    const tokens = await exchangeCode(code);
    const user = await getUserInfo(tokens.access_token);

    saveUser(user.id, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    console.log(`✅ User authorized: ${user.username}#${user.discriminator} (${user.id})`);

    const channelId = "1417345946874019890";
    const channel = client.channels.cache.get(channelId);
    if (channel) {
      channel.send(`✅ **${user.username}** just authorized the bot!`).catch(() => {});
    }

    res.send(`<h2>✅ Authorized ${user.username}#${user.discriminator}</h2>`);
  } catch (err) {
    console.error("❌ Authorization error:", err);
    res.status(500).send("❌ Error during authorization.");
  }
});

app.listen(process.env.PORT, () => {
  console.log(`🌍 Server running on http://localhost:${process.env.PORT}`);
});
