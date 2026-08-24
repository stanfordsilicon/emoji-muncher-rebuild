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
//
// readPreference is forced to "primary" here, overriding whatever the
// connection string itself says (client-code options take precedence over
// same-named URI query params). Confirmed directly in production that reads
// were landing on a lagging secondary: 10 consecutive GETs for a room that
// had just been created and definitely existed came back
// [false,false,false,false,true,false,false,false,false,false] -- not a
// one-time cold-start miss (that would look like a handful of early misses
// that then stay fixed) and not a fully broken connection (that would never
// succeed) but the signature of reads bouncing across replica-set members
// with genuinely different, inconsistently-caught-up data. Every
// game-affecting read in this app needs to see every prior write
// immediately -- a room a player just moved in is not allowed to look like
// it vanished because a read happened to land on a member that hasn't
// replicated that move yet. The primary is always consistent with the
// writes this same app just made, so forcing every read through it removes
// that class of failure outright, at the cost of a request failing loudly
// during a genuine primary failover instead of silently serving stale data
// -- the correct tradeoff for state a player is actively acting on.
function getMongoDb() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    const dbName = process.env.MONGODB_DB_NAME || "emojimunchers_data";
    // Pool sizing tuned for serverless, not for a long-lived server: each
    // cold instance only ever handles a handful of concurrent requests at
    // most (Vercel isn't fanning thousands of parallel requests into one
    // instance here), so a large pool just means more sockets this instance
    // opens and negotiates before it can serve anything, all of it wasted
    // the moment this instance eventually gets torn down. maxIdleTimeMS
    // closes sockets this instance stops using instead of holding them
    // open for a process that may never see another request.
    const client = new MongoClient(uri, {
      readPreference: "primary",
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    clientPromise = client.connect().then((c) => c.db(dbName));
    clientPromise.catch(() => {
      // A failed connection attempt must not poison every future call for
      // the rest of this process's life -- without this, one bad connect()
      // (a blip during cold start, a transient DNS failure) would leave
      // clientPromise permanently set to a rejected promise, since the
      // `if (!clientPromise)` guard above only re-attempts when it's falsy,
      // and a rejected promise is still a truthy value. Clearing it here
      // lets the next call try a genuinely fresh connection instead of
      // replaying the same failure forever.
      clientPromise = null;
    });
  }
  return clientPromise;
}

module.exports = { getMongoDb };
