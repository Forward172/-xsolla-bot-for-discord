const { Client, GatewayIntentBits, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fetch = require('node-fetch');
const config = require('./config.json');
const fs = require('fs');

let db;
async function initializeDB() {
  db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      user_id TEXT
    )
  `);
}

const commands = [{
  name: 'send',
  description: 'Check Transaction ID'
}];

const rest = new REST({ version: '10' }).setToken(config.token);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Кнопка для открытия модального окна
const transactionButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('open_transaction_modal')
    .setLabel('Enter Transaction ID')
    .setStyle(ButtonStyle.Primary)
);

// Модальное окно для ввода ID
const transactionModal = new ModalBuilder()
  .setCustomId('transaction_modal')
  .setTitle('Check Transaction ID');

const transactionInput = new TextInputBuilder()
  .setCustomId('transaction_id')
  .setLabel("Enter your Transaction ID")
  .setStyle(TextInputStyle.Short)
  .setRequired(true);

const firstActionRow = new ActionRowBuilder().addComponents(transactionInput);
transactionModal.addComponents(firstActionRow);

async function checkTransaction(transactionId) {
  return await db.get(
    'SELECT * FROM transactions WHERE transaction_id = ?',
    [transactionId]
  );
}

async function fetchXsollaTransactions(transactionId) {
  const auth = Buffer.from(`${config.xsolla.merchant_id}:${config.xsolla.api_key}`).toString('base64');
  const url = new URL(`https://api.xsolla.com/merchant/v2/merchants/${config.xsolla.merchant_id}/reports/transactions/search.csv`);
  
  const params = {
    project_id: config.xsolla.project_id,
    transaction_id: transactionId,
    status: 'done',
    limit: '100'
  };

  url.search = new URLSearchParams(params).toString();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`
      }
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const csvData = await response.text();
    return parseCSV(csvData);
  } catch (error) {
    console.error('Xsolla API Error:', error.message);
    return null;
  }
}

function parseCSV(csv) {
  if (!csv || csv.trim().length === 0) return [];
  
  const lines = csv.split('\n')
    .map(line => line.replace(/"/g, '').trim())
    .filter(line => line.length > 0);

  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const obj = {};
    const currentline = lines[i].split(',');

    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = currentline[j] ? currentline[j].trim() : '';
    }
    results.push(obj);
  }

  return results;
}

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    // Обработка команды /send
    if (interaction.commandName === 'send') {
      const embed = new EmbedBuilder()
        .setTitle('Checking Transaction ID')
        .setDescription('To check your purchase, click the button below and enter the Transaction number that was sent to your email when you paid, after entering you will receive a role on the server.')
        .setImage('attachment://instruction.png');

      await interaction.reply({
        embeds: [embed],
        files: ['./instruction.png'],
        components: [transactionButton]
      });
    }
  }
  else if (interaction.isButton()) {
    // Обработка нажатия кнопки
    if (interaction.customId === 'open_transaction_modal') {
      await interaction.showModal(transactionModal);
    }
  }
  else if (interaction.isModalSubmit()) {
    // Обработка модального окна
    if (interaction.customId === 'transaction_modal') {
      await interaction.deferReply({ ephemeral: true });
      
      const transactionId = interaction.fields.getTextInputValue('transaction_id');
      const userId = interaction.user.id;

      try {
        const existingTransaction = await checkTransaction(transactionId);
        if (existingTransaction) {
          await interaction.editReply('❌ This code has already been used');
          return;
        }

        const transactions = await fetchXsollaTransactions(transactionId);
        const foundTransaction = transactions?.find(t => t['Transaction ID'] === transactionId);

        if (foundTransaction) {
          await db.run(
            'INSERT INTO transactions (transaction_id, user_id) VALUES (?, ?)',
            [transactionId, userId]
          );
          
          const member = await interaction.guild.members.fetch(userId);
          await member.roles.add(config.role_id);
          await interaction.editReply('✅ Role successfully assigned!');
        } else {
          await interaction.editReply('❌ Transaction ID not found');
        }
      } catch (error) {
        console.error('Error:', error);
        await interaction.editReply('⚠️ An error occurred while processing your request');
      }
    }
  }
});

async function startBot() {
  await initializeDB();
  
  try {
    await rest.put(
      Routes.applicationGuildCommands(config.client_id, config.guild_id),
      { body: commands }
    );
    console.log('Teams registered successfully');
  } catch (error) {
    console.error('Ошибка регистрации команд:', error);
  }

  client.login(config.token);
}

client.once('ready', () => console.log('Бот запущен!'));
startBot();