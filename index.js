const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;        // Your bot token
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; // The log channel ID
const GUILD_ID = process.env.GUILD_ID || null;  // Optional: instant slash cmds in this guild

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel] // needed to receive DMs
});

// --- Slash command definition ---
const commands = [
  new SlashCommandBuilder()
    .setName("dm")
    .setDescription("Send a DM to a user and log it (threaded).")
    .addUserOption(opt =>
      opt.setName("target")
         .setDescription("User to DM")
         .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("message")
         .setDescription("Message to send")
         .setRequired(true)
    )
].map(c => c.toJSON());

// Register slash commands on ready
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID),
        { body: commands }
      );
      console.log("⚡ Slash commands registered (guild — instant).");
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log("🌍 Slash commands registered (global — may take up to 1 hour).");
    }
  } catch (e) {
    console.error("Slash command registration failed:", e);
  }
});

// Helper: get or create a thread for a given user in the log channel
async function getOrCreateUserThread(logChannel, user) {
  const threadName = `DM: ${user.tag} (${user.id})`;

  // Try active threads
  const active = await logChannel.threads.fetchActive();
  const existingActive = active.threads.find(t => t.name === threadName);
  if (existingActive) return existingActive;

  // Try archived threads (so we can reuse old thread)
  const archived = await logChannel.threads.fetchArchived();
  const existingArchived = archived.threads.find(t => t.name === threadName);
  if (existingArchived) {
    try {
      await existingArchived.setArchived(false);
      return existingArchived;
    } catch {
      // fall through to create
    }
  }

  // Create a new thread
  const starterMsg = await logChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🧵 New DM Thread Opened")
        .setDescription(`Conversation with **${user.tag}** (${user.id})`)
        .setTimestamp()
    ]
  });

  const thread = await starterMsg.startThread({
    name: threadName,
    autoArchiveDuration: 1440 // 24h
  });

  return thread;
}

// Slash command handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "dm") return;

  const targetUser = interaction.options.getUser("target");
  const text = interaction.options.getString("message");

  try {
    // Send DM (blue left border)
    const dmEmbed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📩 New Message")
      .setDescription(text)
      .setFooter({ text: `Sent by ${interaction.user.tag}` });

    await targetUser.send({ embeds: [dmEmbed] });

    // Reply to staff
    await interaction.reply({ content: `✅ DM sent to ${targetUser.tag}`, ephemeral: true });

    // Log to channel
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!logChannel || !logChannel.isTextBased()) return;

    const logEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("📑 DM Sent Log")
      .addFields(
        { name: "👤 From", value: `${interaction.user.tag} (${interaction.user.id})` },
        { name: "📥 To", value: `${targetUser.tag} (${targetUser.id})` },
        { name: "💬 Message", value: text }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] });

    // Get/create user thread and echo the sent message there
    const thread = await getOrCreateUserThread(logChannel, targetUser);
    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("📤 Staff → User")
          .addFields(
            { name: "From", value: `${interaction.user.tag} (${interaction.user.id})` },
            { name: "Message", value: text }
          )
          .setTimestamp()
      ]
    });

  } catch (err) {
    console.error(err);
    await interaction.reply({ content: "❌ Could not send DM (user may have DMs closed).", ephemeral: true });
  }
});

// Relay: User replies in DM → forward to their thread
client.on("messageCreate", async (message) => {
  // DMs have type 1 (DMChannel)
  if (message.channel?.type !== 1) return;
  if (message.author.bot) return;

  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!logChannel || !logChannel.isTextBased()) return;

    const thread = await getOrCreateUserThread(logChannel, message.author);

    // Build content + include attachments
    const files = message.attachments?.map(a => a.url) ?? [];

    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("📥 User → Staff")
          .addFields(
            { name: "From", value: `${message.author.tag} (${message.author.id})` },
            { name: "Message", value: message.content?.trim() ? message.content : "_(no text)_" }
          )
          .setTimestamp()
      ],
      files
    });
  } catch (e) {
    console.error("Relay DM → thread failed:", e);
  }
});

// Relay: Staff replies in the user’s thread → forward to the user’s DMs
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const channel = message.channel;

  // Only act inside threads under the log channel
  if (!channel?.isThread()) return;
  if (channel.parentId !== LOG_CHANNEL_ID) return;

  // Identify target user from thread name "DM: username (userId)"
  const match = channel.name.match(/\((\d{5,})\)$/);
  if (!match) return;

  const userId = match[1];
  const dmText = message.content?.trim() || "";

  const files = message.attachments?.map(a => a.url) ?? [];

  try {
    const user = await client.users.fetch(userId);
    if (!user) return;

    // Send DM back to the user
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📩 Message from Staff")
      .setDescription(dmText || "_(no text)_")
      .setFooter({ text: `Sent by ${message.author.tag}` })
      .setTimestamp();

    await user.send({ embeds: [embed], files });

    // Echo confirmation in thread
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("✅ Relayed to User")
          .addFields(
            { name: "To", value: `${user.tag} (${user.id})` },
            { name: "Message", value: dmText || "_(no text)_" }
          )
          .setTimestamp()
      ]
    });
  } catch (e) {
    console.error("Relay thread → DM failed:", e);
    await channel.send("❌ Failed to DM the user (DMs closed or error).");
  }
});

client.login(TOKEN);
  
