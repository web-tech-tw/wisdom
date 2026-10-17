export const PIPELINE_CONFIG = {
    source: {
        uri: Bun.env.SOURCE_MONGODB_URI || "",
        dbName: Bun.env.SOURCE_MONGODB_DB_NAME || "openchat",
        collectionNames: (Bun.env.SOURCE_MONGODB_COLLECTIONS || "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
    },
    target: {
        uri: Bun.env.MONGODB_URI || "mongodb://localhost:27017/nymph",
        collectionName: "knowledge",
    },
    llm: {
        model: Bun.env.ETL_OPENAI_MODEL || "ollama/gemma4:e4b",
        apiKey: Bun.env.ETL_OPENAI_API_KEY || "",
        baseURL: Bun.env.ETL_OPENAI_BASE_URL || "",
        concurrency: Number.parseInt(Bun.env.ETL_CONCURRENCY || "3", 10),
        supportsStructuredOutputs: true,
    },
    thresholds: {
        authorMinOccurrences: 2,
        maxAuthorTokens: 4,
        continuousMergeSeconds: 45,
        threadGapMinutes: 10,
        minThreadMessages: 2,
    },
    notifications: {
        discordWebhookUrl: Bun.env.DISCORD_WEBHOOK_URL || "",
    },
};
