import { connectDatabase } from "./src/databases/connection";
import { PIPELINE_CONFIG } from "./src/pipeline/config";

console.info("==========================================");
console.info("Wisdom Knowledge & ETL Service");
console.info(`- Runtime: Bun ${Bun.version}`);
console.info(`- LLM Model: ${PIPELINE_CONFIG.llm.model}`);
console.info(`- Concurrency: ${PIPELINE_CONFIG.llm.concurrency}`);
console.info("==========================================");

await connectDatabase();

console.info("[Wisdom] Database connected and service is ready.");
console.info("[Wisdom] To run the ETL pipeline: bun run etl");
