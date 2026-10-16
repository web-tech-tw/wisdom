import { describe, it, expect } from "bun:test";
import { extractAndDenoise, matchAuthor, parseRawMessage } from "./extractor";
import type { RawMessageDoc } from "../types";

function doc(content: string, date = "2026/9/9（週三）", time = "12:00"): RawMessageDoc {
    return { _id: `id-${content.length}-${time}`, date, time, content };
}

describe("dual-format author extraction", () => {
    it("splits new-format TAB messages at the first tab", () => {
        const result = matchAuthor("🔰 Pod042-A 萌新\t今天先在筆電上面試試看 Debian + Xfce", new Set());
        expect(result.author).toBe("🔰 Pod042-A 萌新");
        expect(result.content).toBe("今天先在筆電上面試試看 Debian + Xfce");
        expect(result.confident).toBe(true);
    });

    it("falls back to space-prefix matching for old-format messages", () => {
        const known = new Set(["Astolfo。墨"]);
        const result = matchAuthor("Astolfo。墨 呵", known);
        expect(result.author).toBe("Astolfo。墨");
        expect(result.content).toBe("呵");
        expect(result.confident).toBe(true);
    });

    it("splits the author from multiline TAB content at the first tab only", () => {
        const result = matchAuthor("小菜\tcode:\nif (a)\tb else\tc", new Set());
        expect(result.author).toBe("小菜");
        expect(result.content).toBe("code:\nif (a)\tb else\tc");
    });
});

describe("system event classification", () => {
    it("recognizes the new-format leave wording (離開聊天)", () => {
        const msg = parseRawMessage(doc("qodjxj離開聊天", "2026/9/8（週二）", "02:57"), new Set());
        expect(msg.type).toBe("leave");
        expect(msg.author).toBe("qodjxj");
    });

    it("keeps the legacy leave wording (退出聊天) working", () => {
        const msg = parseRawMessage(doc("王小明退出聊天", "2022.03.16 星期三", "10:00"), new Set());
        expect(msg.type).toBe("leave");
        expect(msg.author).toBe("王小明");
    });

    it("does not misclassify TAB messages ending with join wording", () => {
        const msg = parseRawMessage(doc("小菜\t我們歡迎新朋友加入聊天"), new Set());
        expect(msg.type).toBe("message");
        expect(msg.author).toBe("小菜");
    });

    it("classifies TAB sticker messages as sticker noise", () => {
        const msg = parseRawMessage(doc("陳傑瑞\t[貼圖]", "2026/1/26（週一）", "14:01"), new Set());
        expect(msg.type).toBe("sticker");
        expect(msg.author).toBe("陳傑瑞");
    });
});

describe("extractAndDenoise", () => {
    it("merges contiguous new-format messages from the same author", () => {
        const docs = [
            doc("三白王\t你有成功GPU直通？", "2026/9/9（週三）", "18:24"),
            doc("三白王\t換張卡試試", "2026/9/9（週三）", "18:24"),
            doc("三白王\t還是不行", "2026/9/9（週三）", "18:40"),
        ];

        const blocks = extractAndDenoise(docs);
        expect(blocks.length).toBe(2);

        const first = blocks[0];
        expect(first?.author).toBe("三白王");
        expect(first?.content).toBe("你有成功GPU直通？\n換張卡試試");
        expect(first?.rawMessageIds.length).toBe(2);
    });

    it("keeps old-format space-separated parsing intact", () => {
        const docs = [
            doc("Astolfo。墨 呵", "2022.03.20 星期日", "22:49"),
            doc("Astolfo。墨 有錢就能過??", "2022.03.20 星期日", "22:49"),
        ];

        const blocks = extractAndDenoise(docs);
        expect(blocks.length).toBe(1);
        expect(blocks[0]?.author).toBe("Astolfo。墨");
        expect(blocks[0]?.content).toBe("呵\n有錢就能過??");
    });
});
