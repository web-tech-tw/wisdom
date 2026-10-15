/**
 * Strips reasoning content from model messages for OpenAI-compatible providers.
 */
export function stripReasoningContentFromMessages(args: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(args.messages)) {
        return args;
    }

    return {
        ...args,
        messages: args.messages.map((msg: unknown) => {
            if (
                typeof msg === "object" &&
                msg !== null &&
                "role" in msg &&
                (msg as { role?: unknown }).role === "assistant"
            ) {
                const {
                    reasoning_content: _reasoningContent,
                    reasoning: _reasoning,
                    ...rest
                } = msg as Record<string, unknown>;
                return rest;
            }
            return msg;
        }),
    };
}
