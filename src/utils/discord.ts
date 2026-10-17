import { APP_NAME } from "../init/const";
import { PIPELINE_CONFIG } from "../pipeline/config";

export const DISCORD_COLORS = {
    info: 0x3498db,
    success: 0x2ecc71,
    error: 0xe74c3c,
} as const;

export interface DiscordEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

export interface DiscordEmbed {
    title?: string;
    description?: string;
    color?: number;
    fields?: DiscordEmbedField[];
    timestamp?: string;
}

/**
 * Send a webhook notification to Discord. Fails silently (logs only) so that
 * notification issues never break the ETL pipeline itself.
 *
 * @param params.content optional plain-text message
 * @param params.embeds optional rich embeds
 * @returns true when delivered, false when skipped or failed
 */
export async function sendDiscordNotification(params: {
    content?: string;
    embeds?: DiscordEmbed[];
}): Promise<boolean> {
    const url = PIPELINE_CONFIG.notifications.discordWebhookUrl;
    if (!url) {
        return false;
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: APP_NAME,
                content: params.content,
                embeds: params.embeds,
            }),
        });

        if (!response.ok) {
            console.error(`[Discord] Webhook responded with status ${response.status}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error("[Discord] Failed to send webhook notification:", error);
        return false;
    }
}
