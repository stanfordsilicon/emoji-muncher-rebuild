"use strict";

const { MongoClient } = require("mongodb");

let clientPromise = null;

// Single shared connection for the whole process. Every Mongo-backed
// repository (score, analytics) calls this instead of opening its own
// client, so one MONGODB_URI env var is the only thing that needs setting.
//
// client.db() with no argument silently falls back to a database literally
// named "test" whenever the connection string has no database segment in
// its path (e.g. ".../?appName=foo" -- Atlas's own copy-paste string looks
// exactly like this). That's surprising and easy to miss, so an explicit
// name is always passed instead.
function getMongoDb() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    const dbName = process.env.MONGODB_DB_NAME || "emojimunchers_data";
    const client = new MongoClient(uri);
    clientPromise = client.connect().then((c) => c.db(dbName));
  }
  return clientPromise;
}

module.exports = { getMongoDb };
