import { Command, InvalidArgumentError } from "commander";
import { APP_NAME, APP_DESCRIPTION } from "./src/init/const";
import { PIPELINE_CONFIG } from "./src/pipeline/config";
import { runPipeline } from "./src/pipeline/index";

function parseIntegerOption(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        throw new InvalidArgumentError("Expected a number.");
    }
    return parsed;
}

const app = new Command();

app
    .name(APP_NAME)
    .description(APP_DESCRIPTION)
    .version("1.0.0")
    .option("--dry-run", "Preview mode: no writes to the target database")
    .option("--fresh", "Ignore checkpoints and process every date again")
    .option("--days <n>", "Process only the earliest N unprocessed dates", parseIntegerOption)
    .option("--date <pattern>", "Filter source dates by pattern (e.g. \"2026.10\")")
    .option(
        "--concurrency <n>",
        `Max concurrent LLM requests (default ${PIPELINE_CONFIG.llm.concurrency})`,
        parseIntegerOption,
    )
    .action(async (options) => {
        await runPipeline({
            dryRun: options.dryRun ?? false,
            resume: !options.fresh,
            days: options.days,
            targetDate: options.date,
            concurrency: options.concurrency,
        });
    });

app.parseAsync().catch((err) => {
    console.error("Pipeline Error:", err);
    process.exit(1);
});
