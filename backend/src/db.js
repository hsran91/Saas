const dns = require("dns");
const mongoose = require("mongoose");

function parseDnsServers(value) {
  return value
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
}

function usePublicDnsForMongoIfNeeded() {
  const currentServers = dns.getServers();
  const hasLoopbackDns = currentServers.some((server) =>
    server === "127.0.0.1" ||
    server === "::1" ||
    server.startsWith("127.")
  );

  if (!hasLoopbackDns) {
    return currentServers;
  }

  const configuredServers = parseDnsServers(process.env.MONGO_DNS_SERVERS || "1.1.1.1,8.8.8.8");
  dns.setServers(configuredServers);
  return configuredServers;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function connectDatabase() {
  const mongoUri = requireEnv("MONGODB_URI");
  usePublicDnsForMongoIfNeeded();
  await mongoose.connect(mongoUri);
  return mongoose.connection;
}

module.exports = {
  mongoose,
  connectDatabase
};