import { MongoClient, type Collection } from "mongodb";
import mongoose from "mongoose";
import { PIPELINE_CONFIG } from "./config";
import { APP_NAME } from "../init/const";
import type { RawMessageDoc, ExtractedKnowledge } from "./types";
import { extractAndDenoise, buildGlobalAuthorRegistry } from "./tasks/extractor";
import { disentangleThreads } from "./tasks/disentangle";
import { summarizeThread } from "./tasks/summarizer";
import { buildKnowledgeDocuments, loadKnowledgeDocuments, formatKnowledgeMarkdown } from "./tasks/loader";
import { getDbCheckpoint, updateDbCheckpoint, resetDbCheckpoint } from "../databases/models/checkpoint";
import { sendDiscordNotification, DISCORD_COLORS } from "../utils/discord";

export {
    extractAndDenoise,
    buildGlobalAuthorRegistry,
    disentangleThreads,
    summarizeThread,
    buildKnowledgeDocuments,
    loadKnowledgeDocuments,
    formatKnowledgeMarkdown,
    PIPELINE_CONFIG,
};

const CHECKPOINT_KEY_PREFIX = "chat-technical-etl:";

export interface PipelineOptions {
    dryRun?: boolean;
    resume?: boolean;
    days?: number;
    targetDate?: string;
    concurrency?: number;
}

export interface PipelineStats {
    totalRaw: number;
    totalMergedBlocks: number;
    totalCandidateThreads: number;
    totalExtractedItems: number;
    totalLoadedDocs: number;
}

interface CollectionProcessingOptions {
    collectionName: string;
    checkpointKey: string;
    isDryRun: boolean;
    isResume: boolean;
    maxDays?: number;
    targetDate?: string;
    concurrency: number;
}

async function processSourceCollection(
    sourceCol: Collection<RawMessageDoc>,
    options: CollectionProcessingOptions,
): Promise<PipelineStats> {
    const stats: PipelineStats = {
        totalRaw: 0,
        totalMergedBlocks: 0,
        totalCandidateThreads: 0,
        totalExtractedItems: 0,
        totalLoadedDocs: 0,
    };

    // 1. Reset checkpoint on fresh start
    if (!options.isResume && !options.isDryRun) {
        await resetDbCheckpoint(options.checkpointKey);
    }

    // 2. Fetch checkpoint from database as Single Source of Truth
    const dbCheckpoint = options.isResume
        ? await getDbCheckpoint(options.checkpointKey)
        : { completedDates: [], totalExtracted: 0 };
    const processedSet = new Set<string>(dbCheckpoint.completedDates);

    // 3. Pre-index global author registry from historical system events
    console.info(`[Source] Pre-indexing global author registry from "${options.collectionName}"...`);
    const globalAuthors = await buildGlobalAuthorRegistry(sourceCol);
    console.info(`[Source] Indexed ${globalAuthors.size} distinct authors in global registry.`);

    // 4. Fetch distinct dates
    let dates: string[] = [];
    if (options.targetDate) {
        dates = await sourceCol.distinct("date", { date: { $regex: options.targetDate } });
    } else {
        dates = await sourceCol.distinct("date");
    }

    dates.sort((a, b) => a.localeCompare(b));

    if (options.isResume && processedSet.size > 0) {
        dates = dates.filter((d) => !processedSet.has(d));
        console.info(`[Resume] Skipping ${processedSet.size} already processed dates. ${dates.length} dates remaining.`);
    }

    if (options.maxDays && options.maxDays > 0) {
        dates = dates.slice(0, options.maxDays);
    }

    console.info(`[Pipeline] Found ${dates.length} dates to process.\n`);

    for (let dIndex = 0; dIndex < dates.length; dIndex++) {
        const dateStr = dates[dIndex];
        if (!dateStr) continue;

        console.info("──────────────────────────────────────────────────");
        console.info(`[${dIndex + 1}/${dates.length}] Processing Date: ${dateStr}`);

        try {
            // Fetch all raw messages for this date, sorted by time
            const rawDocs = await sourceCol
                .find({ date: dateStr })
                .sort({ time: 1, createdAt: 1 })
                .toArray();

            stats.totalRaw += rawDocs.length;
            console.info(`  - Raw messages fetched: ${rawDocs.length}`);

            if (!rawDocs.length) {
                processedSet.add(dateStr);
                if (!options.isDryRun) {
                    await updateDbCheckpoint({ key: options.checkpointKey, completedDate: dateStr, extractedCount: 0 });
                }
                continue;
            }

            // Task 1: Extract, Denoise & Merge
            const mergedBlocks = extractAndDenoise(rawDocs, globalAuthors);
            stats.totalMergedBlocks += mergedBlocks.length;
            console.info(`  - Merged into blocks: ${mergedBlocks.length}`);

            // Task 2: Disentangle Discussion Threads
            const threads = disentangleThreads(mergedBlocks);
            stats.totalCandidateThreads += threads.length;
            console.info(`  - Segmented discussion threads: ${threads.length}`);

            if (!threads.length) {
                console.info("  - No discussion threads formed on this date.");
                processedSet.add(dateStr);
                if (!options.isDryRun) {
                    await updateDbCheckpoint({ key: options.checkpointKey, completedDate: dateStr, extractedCount: 0 });
                }
                continue;
            }

            // Task 3: LLM Summarization with Concurrency Control
            console.info(`  - Summarizing ${threads.length} threads with ${PIPELINE_CONFIG.llm.model}...`);
            const extractedItems: ExtractedKnowledge[] = [];

            for (let i = 0; i < threads.length; i += options.concurrency) {
                const batch = threads.slice(i, i + options.concurrency);
                const promises = batch.map((t) => summarizeThread(t, PIPELINE_CONFIG.llm.model));
                const results = await Promise.all(promises);

                for (const res of results) {
                    if (res) {
                        extractedItems.push(res);
                    }
                }
            }

            // Stamp the source channel (via.channelId) onto each knowledge item
            const sourceChannelId = rawDocs.find((doc) => doc.via?.channelId)?.via?.channelId;
            for (const item of extractedItems) {
                item.sourceChannelId = sourceChannelId;
            }

            stats.totalExtractedItems += extractedItems.length;
            console.info(`  - Extracted ${extractedItems.length} valuable knowledge items.`);

            // Print preview
            for (const item of extractedItems) {
                console.info(`    + [${item.category}] ${item.topic} (Tags: ${item.tags.join(", ")})`);
                if (options.isDryRun) {
                    console.info("\n--- PREVIEW MARKDOWN SLICE ---");
                    console.info(formatKnowledgeMarkdown(item));
                    console.info("------------------------------\n");
                }
            }

            // Task 4: Load to Target MongoDB
            if (!options.isDryRun && extractedItems.length > 0) {
                const knowledgeDocs = buildKnowledgeDocuments(extractedItems);
                const { inserted, updated } = await loadKnowledgeDocuments(knowledgeDocs);
                stats.totalLoadedDocs += inserted + updated;
                console.info(`  - Target DB: ${inserted} inserted, ${updated} updated.`);
            }

            // Mark date as fully completed in Database (SSOT)
            processedSet.add(dateStr);

            if (!options.isDryRun) {
                await updateDbCheckpoint({
                    key: options.checkpointKey,
                    completedDate: dateStr,
                    extractedCount: extractedItems.length,
                });
            }
        } catch (err) {
            console.error(`  [Pipeline Error] Failed to process date ${dateStr}:`, err);
            console.warn(`  [Checkpoint] Date ${dateStr} excluded from completed list; will be retried on next resume.`);
            await sendDiscordNotification({
                embeds: [{
                    title: `日期處理失敗:${options.collectionName} ${dateStr}`,
                    description: String((err as Error).message).slice(0, 1000),
                    color: DISCORD_COLORS.error,
                    timestamp: new Date().toISOString(),
                }],
            });
        }
    }

    return stats;
}

export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineStats> {
    const isDryRun = options.dryRun ?? false;
    const isResume = options.resume ?? true;
    const maxDays = options.days;
    const targetDateArg = options.targetDate;
    const concurrency = options.concurrency ?? PIPELINE_CONFIG.llm.concurrency;

    console.info(APP_NAME, "\n====");
    console.info(`[Model]: ${PIPELINE_CONFIG.llm.model}`);
    console.info(`[Mode]: ${isDryRun ? "DRY RUN (No target DB writes)" : "PRODUCTION (Writing to target DB)"}`);
    console.info(`[Concurrency]: ${concurrency}`);
    if (maxDays) console.info(`[Limit]: ${maxDays} days`);
    if (targetDateArg) console.info(`[Target Date]: ${targetDateArg}`);

    // 1. Connect to Target Database first (for Checkpoint SSOT and Knowledge Storage)
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(PIPELINE_CONFIG.target.uri);
    }

    // 2. Validate source configuration
    if (!PIPELINE_CONFIG.source.uri) {
        throw new Error("SOURCE_MONGODB_URI environment variable is required.");
    }
    if (!PIPELINE_CONFIG.source.collectionNames.length) {
        throw new Error("SOURCE_MONGODB_COLLECTIONS environment variable is required (comma-separated collection names).");
    }

    // 3. Connect to source MongoDB
    console.info("Connecting to source database...");
    const sourceClient = new MongoClient(PIPELINE_CONFIG.source.uri);
    await sourceClient.connect();
    const sourceDb = sourceClient.db(PIPELINE_CONFIG.source.dbName);

    await sendDiscordNotification({
        embeds: [{
            title: "Wisdom ETL 啟動",
            color: DISCORD_COLORS.info,
            fields: [
                { name: "模式", value: isDryRun ? "DRY RUN" : "PRODUCTION", inline: true },
                { name: "模型", value: PIPELINE_CONFIG.llm.model, inline: true },
                { name: "並行", value: String(concurrency), inline: true },
                { name: "來源集合", value: PIPELINE_CONFIG.source.collectionNames.join(", ") },
            ],
            timestamp: new Date().toISOString(),
        }],
    });

    const stats: PipelineStats = {
        totalRaw: 0,
        totalMergedBlocks: 0,
        totalCandidateThreads: 0,
        totalExtractedItems: 0,
        totalLoadedDocs: 0,
    };

    // 4. Process each archived source collection
    for (const collectionName of PIPELINE_CONFIG.source.collectionNames) {
        console.info("\n==================================================");
        console.info(`[Source] Processing collection: ${collectionName}`);
        console.info("==================================================");

        const sourceCol = sourceDb.collection<RawMessageDoc>(collectionName);
        const collectionStats = await processSourceCollection(sourceCol, {
            collectionName,
            checkpointKey: `${CHECKPOINT_KEY_PREFIX}${collectionName}`,
            isDryRun,
            isResume,
            maxDays,
            targetDate: targetDateArg,
            concurrency,
        });

        stats.totalRaw += collectionStats.totalRaw;
        stats.totalMergedBlocks += collectionStats.totalMergedBlocks;
        stats.totalCandidateThreads += collectionStats.totalCandidateThreads;
        stats.totalExtractedItems += collectionStats.totalExtractedItems;
        stats.totalLoadedDocs += collectionStats.totalLoadedDocs;

        if (collectionStats.totalRaw > 0) {
            await sendDiscordNotification({
                embeds: [{
                    title: `來源集合完成:${collectionName}`,
                    color: DISCORD_COLORS.success,
                    fields: [
                        { name: "原始訊息", value: String(collectionStats.totalRaw), inline: true },
                        { name: "討論串", value: String(collectionStats.totalCandidateThreads), inline: true },
                        { name: "萃取條目", value: String(collectionStats.totalExtractedItems), inline: true },
                        { name: "寫入文件", value: String(collectionStats.totalLoadedDocs), inline: true },
                    ],
                    timestamp: new Date().toISOString(),
                }],
            });
        }
    }

    // Cleanup connections
    await sourceClient.close();
    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }

    console.info("\n==================================================");
    console.info("Pipeline Execution Completed Summary");
    console.info(`- Total Raw Messages Processed: ${stats.totalRaw}`);
    console.info(`- Total Merged Message Blocks: ${stats.totalMergedBlocks}`);
    console.info(`- Total Candidate Tech Threads: ${stats.totalCandidateThreads}`);
    console.info(`- Total Knowledge Items Extracted: ${stats.totalExtractedItems}`);
    if (!isDryRun) {
        console.info(`- Total Documents Loaded to Target DB: ${stats.totalLoadedDocs}`);
    }
    console.info("==================================================");

    await sendDiscordNotification({
        embeds: [{
            title: isDryRun ? "Wisdom ETL 乾跑完成" : "Wisdom ETL 完成",
            color: DISCORD_COLORS.success,
            fields: [
                { name: "原始訊息", value: String(stats.totalRaw), inline: true },
                { name: "合併區塊", value: String(stats.totalMergedBlocks), inline: true },
                { name: "討論串", value: String(stats.totalCandidateThreads), inline: true },
                { name: "萃取條目", value: String(stats.totalExtractedItems), inline: true },
                { name: "寫入文件", value: String(stats.totalLoadedDocs), inline: true },
            ],
            timestamp: new Date().toISOString(),
        }],
    });

    return stats;
}
