
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error('MONGO_URI is missing from .env');
}

const client = new MongoClient(uri);

let db;

async function connectMongo() {
  if (db) return db;

  await client.connect();

  db = client.db(
    process.env.MONGO_DB_NAME || 'campus_eats_feedback'
  );

  console.log(`Connected to MongoDB (${db.databaseName})`);

  return db;
}

async function closeMongo() {
  if (client) {
    await client.close();
    db = undefined;
  }
}

module.exports = { connectMongo, closeMongo };