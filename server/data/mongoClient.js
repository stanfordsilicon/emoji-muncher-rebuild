"use strict";

const { MongoClient } = require("mongodb");

let clientPromise = null;

// Single shared connection for the whole process. Every Mongo-backed
// repository (score, analytics) calls this instead of opening its own
// client, so one MONGODB_URI env var is the only thing that needs setting.
function getMongoDb() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    const client = new MongoClient(uri);
    clientPromise = client.connect().then((c) => c.db());
  }
  return clientPromise;
}

module.exports = { getMongoDb };
