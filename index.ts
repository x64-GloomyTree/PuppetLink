/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Meow meow meow, purr, I'm a little kitten, I love yarn balls and sitting on my owner's lap
 * May this artifact of my soul bring a little more peace to this troubled world
 */

import { definePluginSettings } from "@api/Settings";
import { DataStore } from "@api/index";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore, GuildMemberStore, SelectedGuildStore } from "@webpack/common";
import bgmSrc from "./bgmData";
import startupSrc from "./startupData";
import logoSrc from "./logoData";
import zilchBgmSrc from "./zilchBgmData";
import metaBgmSrc from "./meta";
import flashbangSrc from "./flashbang";
// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_USERNAME = "The Fish GayerThe Fish CurserAPP";
const SEEN_KEY = "IllusionaryFusion_seenTexts";
const SIMILARITY_THRESHOLD = 0.8;
const CUTSCENE_SCAN_INTERVAL_MS = 750;
const DEFAULT_FLICKER_COLOR = "#0302d2";
const THEME_CSS_ID = "vc-puppetlink-theme-css";
const ZILCH_GLOW_TARGETS = '[class*="messageContent"], [class*="markup"]';
let flashbangOverlay: HTMLDivElement | null = null;
// ─── Types ────────────────────────────────────────────────────────────────────

type RawEntry = {
    listId: string;
    username: string;
    text: string;
    embedText: string;
    videoUrl: string;
    ageMs: number;
    timeMs: number;
    mentionsMe: boolean;
};

type Candidate = {
    listIds: string[];
    username: string;
    text: string;
    embedText: string;
    normalized: string;
    videoUrl: string;
    ageMs: number;
    mentionsMe: boolean;
};

// ─── Theme registry ───────────────────────────────────────────────────────────
// To add a new theme: add an entry here and import its css/bgm at the top.
// The "none" id is reserved for disabling all theme features.

const THEMES = [
    {
        id: "none",
        label: "None"
    },
    {
        id: "illusion",
        label: "Illusion",   // injected as a <style> tag when active
        bgm: bgmSrc        // uses the existing BGM system
    },
    {
        id: "zilch",
        label: "zilch.",  // injected as a <style> tag when active
		bgm: zilchBgmSrc      // uses the existing BGM system
    },
    {
        id: "meta",
        label: "meta",  // injected as a <style> tag when active
		bgm: metaBgmSrc      // uses the existing BGM system
    }
] as const;

type ThemeId = typeof THEMES[number]["id"];

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
	activeTheme: {
		description: "Active visual theme",
		type: OptionType.SELECT,
		options: [
			{ label: "None",     value: "none" },
			{ label: "Illusion", value: "illusion", default: true },
			{ label: "zilch.",    value: "zilch" },
			{ label: "meta",    value: "meta" }	
		],
		onChange: (val: string) => {
			applyTheme(val as ThemeId);
		}
	},
    // ── Illusion theme settings ──────────────────────────────────────────────
    flickerEnabled: {
        description: "[Illusion] Enable the letter flicker effect",
        type: OptionType.BOOLEAN,
        default: true,
	    hidden: () => settings.store.activeTheme !== "illusion"
    },
    flickerColor: {
        description: "[Illusion] The color letters flicker to (hex)",
        type: OptionType.STRING,
        default: DEFAULT_FLICKER_COLOR,
		hidden: () => settings.store.activeTheme !== "illusion"
    },
    tickInterval: {
        description: "[Illusion] How often the flicker ticks (ms), lower = more chaotic",
        type: OptionType.SLIDER,
        default: 80,
        markers: [30, 50, 80, 120, 200, 400],
		hidden: () => settings.store.activeTheme !== "illusion"
    },
    flickerChance: {
        description: "[Illusion] Probability a letter flickers per tick, higher = more flicker",
        type: OptionType.SLIDER,
        default: 4,
        markers: [1, 2, 4, 8, 12, 20, 40],
		hidden: () => settings.store.activeTheme !== "illusion"
    },
    holdDuration: {
        description: "[Illusion] How long (ms) a letter stays the flicker color",
        type: OptionType.SLIDER,
        default: 120,
        markers: [40, 80, 120, 200, 350, 500, 800],
		hidden: () => settings.store.activeTheme !== "illusion"
    },
	zilchGlowEnabled: {
		description: "[Zilch] Enable neon glow pulse",
		type: OptionType.BOOLEAN,
		default: true,
		hidden: () => settings.store.activeTheme !== "zilch"
	},
	zilchGlowColor: {
		description: "[Zilch] Glow color (hex)",
		type: OptionType.STRING,
		default: "#ffe045", // neon yellow-ish
		hidden: () => settings.store.activeTheme !== "zilch"
	},
	zilchGlowCycleMs: {
		description: "[Zilch] Glow cycle duration (ms)",
		type: OptionType.SLIDER,
		default: 8000,
		markers: [5000, 6000, 7000, 8000, 9000, 10000],
		hidden: () => settings.store.activeTheme !== "zilch"
	},
	zilchGlowIntensity: {
		description: "[Zilch] Glow intensity",
		type: OptionType.SLIDER,
		default: 0.5, // keep default subtle
		markers: [0.2, 0.5, 0.7, 1, 1.5, 2],
		hidden: () => settings.store.activeTheme !== "zilch"
	},
    // ── Cutscene / scan settings (shared, used when any theme is active) ──────
    cutsceneMode: {
        description: "Which cutscenes to show",
        type: OptionType.SELECT,
        options: [
            { label: "Show all cutscenes", value: "all", default: true },
            { label: "Show only new cutscenes", value: "new" },
            { label: "Show no cutscenes", value: "none" }
        ]
    },
    maxAgeSeconds: {
        description: "Only trigger on cutscenes newer than this many seconds",
        type: OptionType.SLIDER,
        default: 15,
        markers: [5, 10, 15, 20, 25]
    },
    bootScreenEnabled: {
        description: "Show fake boot screen on Discord launch",
        type: OptionType.BOOLEAN,
        default: true
    },
	flashbangEnabled: {
		description: "Enable flashbang effect for other people's auras",
		type: OptionType.BOOLEAN,
		default: true,
	},
    bgmEnabled: {
        description: "Enable looping background music",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: (val: boolean) => {
            if (val) void startBGM(false);
            else stopBGM();
        }
    },
    bgmVolume: {
        description: "BGM volume",
        type: OptionType.SLIDER,
        default: 35,
        markers: [0, 10, 20, 35, 50, 70, 100]
    }
});

// ─── Flicker constants ────────────────────────────────────────────────────────

const FLICKER_TEXT_CONTAINERS = [
    '[class*="messageContent"]',
    '[class*="markup"]',
    '[class*="topic"]',
    '[class*="subtitleContainer"]'
].join(", ");

const FLICKER_SKIP_CLASSES = [
    "username", "name_", "headerText", "nameAndDecorators",
    "timestamp", "botTag", "roleIcon", "emojiContainer",
    "hiddenVisually", "edited", "repliedTextContent",
    "channelTextArea", "slateTextArea", "editor", "textArea",
    "placeholder", "input", "searchBar"
];

// ─── State ────────────────────────────────────────────────────────────────────

let processedListIds = new Set<string>();
let flickerInterval: ReturnType<typeof setInterval> | null = null;
let cutsceneScanTimer: ReturnType<typeof setInterval> | null = null;
let flickerObserver: MutationObserver | null = null;
let activeOverlay: HTMLDivElement | null = null;
let bgmAudio: HTMLAudioElement | null = null;
let bgmUnlockBanner: HTMLDivElement | null = null;
let bootOverlay: HTMLDivElement | null = null;
let lastTickInterval = 80;
let zilchGlowRaf: number | null = null;
let zilchGlowStartTime: number | null = null;

// ─── Theme lifecycle ──────────────────────────────────────────────────────────

function applyTheme(id: ThemeId) {
    stopFlickerLoop();
    unwrapAllLetters();
    stopZilchGlowLoop();
    stopBGM();

    const theme = THEMES.find(t => t.id === id) as any;

    if (id === "illusion") {
        processExistingFlickerTargets();
        startFlickerLoop();
    }

    if (id === "zilch") {
        startZilchGlowLoop();
    }

    // Only start BGM here if the boot screen is already gone
    if (settings.store.bgmEnabled && !bootOverlay) {
        void startBGM(false);
    }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function normalize(text: string): string {
    return text
        .replace(/<@!?\d+>/g, "")
        .replace(/@[^\s]+/g, "")
        .replace(/#\d+/g, "")
        .replace(/\(\d+\/\d+\)/g, "")
        .replace(/\b\d+\b/g, "")
        .replace(/[^\p{L}\p{N}\s\[\]]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function mergeEntries(entries: RawEntry[]): Candidate[] {
    const merged: Candidate[] = [];
    const GROUP_WINDOW_MS = 15000;

    for (const entry of entries) {
        const last = merged[merged.length - 1];

        const canMerge =
            last &&
            last.username === entry.username &&
            Math.abs(last.ageMs - entry.ageMs) <= GROUP_WINDOW_MS;

        if (canMerge) {
            last.listIds.push(entry.listId);
            last.text = [last.text, entry.text].filter(Boolean).join(" ");
            last.embedText = [last.embedText, entry.embedText].filter(Boolean).join(" ");
            if (!last.videoUrl && entry.videoUrl) last.videoUrl = entry.videoUrl;
            last.mentionsMe = last.mentionsMe || entry.mentionsMe;
            last.normalized = normalize(last.text);
            last.ageMs = Math.min(last.ageMs, entry.ageMs);
        } else {
            merged.push({
                listIds: [entry.listId],
                username: entry.username,
                text: entry.text,
                embedText: entry.embedText,
                normalized: normalize(entry.text),
                videoUrl: entry.videoUrl,
                ageMs: entry.ageMs,
                mentionsMe: entry.mentionsMe
            });
        }
    }

    return merged;
}

function similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;

    const len = Math.max(a.length, b.length);
    let same = 0;

    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] === b[i]) same++;
    }

    return same / len;
}

async function getSeenTexts(): Promise<string[]> {
    return (await DataStore.get(SEEN_KEY)) ?? [];
}

async function addSeenText(text: string) {
    const list = await getSeenTexts();
    if (!list.includes(text)) {
        list.push(text);
        await DataStore.set(SEEN_KEY, list);
    }
}

function scheduleAudioUnlockOnClick() {
    showBgmUnlockBanner(); // still show the banner
    const handler = () => {
        document.body.removeEventListener("click", handler);
        removeBgmUnlockBanner();
        void startBGM(true);
    };
    document.body.addEventListener("click", handler, { once: true });
}

async function hasSeenSimilar(text: string): Promise<boolean> {
    const list = await getSeenTexts();
    return list.some(entry => similarity(entry, text) >= SIMILARITY_THRESHOLD);
}

// ─── Flicker ──────────────────────────────────────────────────────────────────

let zilchGlowTimer: ReturnType<typeof setInterval> | null = null;

function runZilchGlowFrame(timestamp: number) {
    if (settings.store.activeTheme !== "zilch" || !settings.store.zilchGlowEnabled) {
        zilchGlowRaf = requestAnimationFrame(runZilchGlowFrame);
        return;
    }

    if (zilchGlowStartTime === null) zilchGlowStartTime = timestamp;

    const color = settings.store.zilchGlowColor || "#ffe045";
    const cycle = settings.store.zilchGlowCycleMs || 8000;
    const intensity = settings.store.zilchGlowIntensity || 0.5;

    const t = ((timestamp - zilchGlowStartTime) % cycle) / cycle;
    const breath = Math.sin(t * Math.PI); // 0→1→0 smooth

    const spread = intensity * breath;
    const inner = Math.max(spread * 0.2, 0);
    const outer = Math.max(spread * 4, 0);

    const filterValue =
        spread > 0.02
            ? `drop-shadow(0 0 ${inner}px ${color}) drop-shadow(0 0 ${outer}px ${color})`
            : "none";

    document.querySelectorAll(ZILCH_GLOW_TARGETS).forEach(el => {
        (el as HTMLElement).style.filter = filterValue;
    });

    zilchGlowRaf = requestAnimationFrame(runZilchGlowFrame);
}

function startZilchGlowLoop() {
    stopZilchGlowLoop();
    zilchGlowStartTime = null;
    zilchGlowRaf = requestAnimationFrame(runZilchGlowFrame);
}

function stopZilchGlowLoop() {
    if (zilchGlowRaf !== null) {
        cancelAnimationFrame(zilchGlowRaf);
        zilchGlowRaf = null;
    }
    zilchGlowStartTime = null;

    document.querySelectorAll(ZILCH_GLOW_TARGETS).forEach(el => {
        (el as HTMLElement).style.filter = "";
    });
}
function shouldSkipFlicker(el: Element): boolean {
    const cls = String((el as HTMLElement).className || "");
    if (FLICKER_SKIP_CLASSES.some(s => cls.includes(s))) return true;
    if (el.closest("[role='textbox']")) return true;
    if (el.closest("form")) return true;
    if (el.closest("[class*='channelTextArea']")) return true;
    if (el.closest("[class*='slateTextArea']")) return true;
    if (el.closest("[contenteditable='true']")) return true;
    return false;
}

function wrapLetters(container: Element) {
    if ((container as any).__flickerWrapped) return;
    if (shouldSkipFlicker(container)) return;
    (container as any).__flickerWrapped = true;

    const spans = [...container.querySelectorAll("span:not([class])")] as HTMLSpanElement[];
    for (const span of spans) {
        if ((span as any).__flickerWrapped) continue;
        if (shouldSkipFlicker(span)) continue;

        const text = span.textContent ?? "";
        if (!text.trim()) continue;

        const fragment = document.createDocumentFragment();
        for (const char of text) {
            const letterSpan = document.createElement("span");
            letterSpan.textContent = char;
            letterSpan.dataset.flickerLetter = "1";
            fragment.appendChild(letterSpan);
        }

        span.textContent = "";
        span.appendChild(fragment);
        (span as any).__flickerWrapped = true;
    }
}

function unwrapAllLetters() {
    document.querySelectorAll("span:not([class])").forEach(span => {
        if (!(span as any).__flickerWrapped) return;
        const letters = [...span.querySelectorAll('[data-flicker-letter="1"]')];
        if (!letters.length) return;
        span.textContent = letters.map(l => l.textContent ?? "").join("");
        (span as any).__flickerWrapped = false;
    });
}

function processExistingFlickerTargets() {
    document.querySelectorAll(FLICKER_TEXT_CONTAINERS).forEach(el => {
        if (!shouldSkipFlicker(el)) wrapLetters(el);
    });
}

function tickFlicker() {
    if (!settings.store.flickerEnabled) return;

    const color = settings.store.flickerColor || DEFAULT_FLICKER_COLOR;
    const chance = (settings.store.flickerChance || 4) / 1000;
    const hold = settings.store.holdDuration || 120;

    const letters = document.querySelectorAll('[data-flicker-letter="1"]');
    for (const letter of letters) {
        if (letter.closest("[role='textbox']") || letter.closest("[contenteditable='true']")) continue;
        if (Math.random() < chance) {
            (letter as HTMLElement).style.color = color;
            (letter as HTMLElement).style.textShadow = `0 0 4px ${color}, 0 0 10px ${color}`;
            setTimeout(() => {
                (letter as HTMLElement).style.color = "";
                (letter as HTMLElement).style.textShadow = "";
            }, hold + Math.random() * 80);
        }
    }
}

function startFlickerLoop() {
    lastTickInterval = settings.store.tickInterval || 80;
    if (flickerInterval) clearInterval(flickerInterval);

    flickerInterval = setInterval(() => {
        const currentInterval = settings.store.tickInterval || 80;
        if (currentInterval !== lastTickInterval) {
            startFlickerLoop();
            return;
        }
        tickFlicker();
    }, lastTickInterval);
}

function stopFlickerLoop() {
    if (flickerInterval) {
        clearInterval(flickerInterval);
        flickerInterval = null;
    }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

function closeOverlay() {
    if (activeOverlay) {
        activeOverlay.remove();
        activeOverlay = null;
    }
    syncBGMVolume();
}

function triggerFlashbang() {
    if (flashbangOverlay) return; // already running

    const overlay = document.createElement("div");
    overlay.id = "vc-flashbang-overlay";
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "1000001",
        background: "white",
        opacity: "0",
        pointerEvents: "none",
        transition: "opacity 0.05s linear",
    });
    document.body.appendChild(overlay);
    flashbangOverlay = overlay;

    // Phase 1: deep-fry ramp — progressively saturate + brighten over 2s
    const deepFryEl = document.createElement("div");
    Object.assign(deepFryEl.style, {
        position: "fixed",
        inset: "0",
        zIndex: "1000000",
        pointerEvents: "none",
        transition: "filter 2s linear",
        filter: "saturate(1) brightness(1) contrast(1)",
    });
    document.body.appendChild(deepFryEl);

    // Kick off the deep-fry filter ramp on next frame
    requestAnimationFrame(() => {
        deepFryEl.style.filter = "saturate(8) brightness(3) contrast(2)";
    });

    // Phase 2: after 2s, slam to full white + play sound
    setTimeout(() => {
        overlay.style.transition = "opacity 0.1s linear";
        overlay.style.opacity = "1";
        deepFryEl.remove();

        const audio = new Audio(flashbangSrc);
        audio.volume = (settings.store.bgmVolume ?? 35) / 100;
        audio.play().catch(() => {});

        // Phase 3: hold white for 5s, then fade back over 3s
        setTimeout(() => {
            overlay.style.transition = "opacity 3s ease-out";
            overlay.style.opacity = "0";

            setTimeout(() => {
                overlay.remove();
                flashbangOverlay = null;
            }, 3000);
        }, 5000);
    }, 2000);
}

function createOverlay(videoUrl: string) {
    closeOverlay();

    const overlay = document.createElement("div");
    overlay.id = "vc-cutscene-overlay";
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        background: "#000",
        zIndex: "999999",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center"
    });

    const video = document.createElement("video");
    video.src = videoUrl;
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    Object.assign(video.style, {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        background: "#000"
    });

    const skip = document.createElement("button");
    skip.textContent = "Skip";
    Object.assign(skip.style, {
        position: "absolute",
        top: "24px",
        right: "24px",
        padding: "10px 18px",
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.25)",
        borderRadius: "8px",
        fontFamily: "Roboto Mono, monospace",
        cursor: "pointer",
        zIndex: "2"
    });

    skip.onclick = closeOverlay;
    video.onended = closeOverlay;

    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            closeOverlay();
            document.removeEventListener("keydown", onKey);
        }
    };
    document.addEventListener("keydown", onKey);

    overlay.appendChild(video);
    overlay.appendChild(skip);
    document.body.appendChild(overlay);
    activeOverlay = overlay;
    if (bgmAudio) bgmAudio.volume = 0;

    video.play().catch(() => {
        const playBtn = document.createElement("button");
        playBtn.textContent = "Play cutscene";
        Object.assign(playBtn.style, {
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            padding: "14px 24px",
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "10px",
            fontFamily: "Roboto Mono, monospace",
            cursor: "pointer",
            zIndex: "3"
        });

        playBtn.onclick = () => {
            video.play().catch(() => {});
            playBtn.remove();
        };

        overlay.appendChild(playBtn);
    });
}

// ─── BGM ──────────────────────────────────────────────────────────────────────

function stopBGM() {
    if (bgmAudio) {
        bgmAudio.pause();
        bgmAudio.src = "";
        bgmAudio = null;
    }
}

function syncBGMVolume() {
    if (!bgmAudio) return;

    if (activeOverlay) {
        bgmAudio.volume = 0;
        return;
    }

    bgmAudio.volume = (settings.store.bgmVolume ?? 35) / 100;
}

function removeBgmUnlockBanner() {
    if (bgmUnlockBanner) {
        bgmUnlockBanner.remove();
        bgmUnlockBanner = null;
    }
}

function showBgmUnlockBanner() {
    if (bgmUnlockBanner || !settings.store.bgmEnabled) return;

    const banner = document.createElement("div");
    banner.id = "vc-bgm-unlock-banner";
    Object.assign(banner.style, {
        position: "fixed",
        left: "50%",
        bottom: "24px",
        transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.88)",
        color: "#fff",
        padding: "12px 16px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        zIndex: "999999",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontFamily: "Roboto Mono, monospace"
    });

    const text = document.createElement("span");
    text.textContent = "Audio is locked by Discord/Chromium. Click once to enable BGM.";

    const button = document.createElement("button");
    button.textContent = "Force audio";
    Object.assign(button.style, {
        padding: "8px 12px",
        background: "#111",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.22)",
        borderRadius: "8px",
        cursor: "pointer",
        fontFamily: "inherit"
    });

    button.onclick = () => {
        removeBgmUnlockBanner();
        void startBGM(true);
    };

    banner.appendChild(text);
    banner.appendChild(button);
    document.body.appendChild(banner);
    bgmUnlockBanner = banner;
}

async function startBGM(fromUserGesture = false) {
    stopBGM();
    removeBgmUnlockBanner();
    if (!settings.store.bgmEnabled) return;

    // Use the active theme's BGM source if available, fallback to default bgmSrc
    const activeTheme = THEMES.find(t => t.id === settings.store.activeTheme) as any;
    const src = activeTheme?.bgm ?? bgmSrc;

    bgmAudio = new Audio(src);
    bgmAudio.loop = true;
    bgmAudio.volume = (settings.store.bgmVolume ?? 35) / 100;

    try {
        await bgmAudio.play();
        console.log("[IllusionaryFusion] BGM started");
    } catch (err) {
        console.warn("[IllusionaryFusion] BGM blocked:", err);
        if (!fromUserGesture) scheduleAudioUnlockOnClick();
    }
}

// ─── Cutscene scanning ────────────────────────────────────────────────────────

function getMessageAuthorName(article: Element): string {
    const readUsername = (el: Element | null) =>
        ((el?.querySelector("[id^='message-username-']") as HTMLElement | null)?.textContent ?? "").trim();

    let username = readUsername(article);
    if (username) return username;

    let prev = article.previousElementSibling;
    let checked = 0;

    while (prev && checked < 5) {
        if (prev.matches("div[role='article']")) {
            username = readUsername(prev);
            if (username) return username;
            checked++;
        }
        prev = prev.previousElementSibling;
    }

    return "";
}

function getVisibleCandidates(): Candidate[] {
    const maxAgeMs = (settings.store.maxAgeSeconds ?? 60) * 1000;
    const me = UserStore.getCurrentUser();
    if (!me) return [];

    const guildId = SelectedGuildStore.getGuildId();
    const member = guildId ? GuildMemberStore.getMember(guildId, me.id) : null;
    const myNames = [me.username, me.globalName, member?.nick].filter(Boolean) as string[];

    return ([...document.querySelectorAll("div[role='article']")]
        .map(article => {
            const contentEl = article.querySelector("[id^='message-content-']") as HTMLElement | null;
            const text = contentEl?.textContent?.trim() ?? "";

            const embedText = [...article.querySelectorAll("[class*='embed']")]
                .map(el => (el.textContent ?? "").trim())
                .join(" ");

            const username = getMessageAuthorName(article);
            const listId = article.getAttribute("data-list-item-id") ?? "";
            const timeIso = (article.querySelector("time") as HTMLTimeElement | null)?.dateTime ?? "";
            const ageMs = timeIso ? Date.now() - new Date(timeIso).getTime() : Infinity;

            const video = article.querySelector("video") as HTMLVideoElement | null;
            const directLink = [...article.querySelectorAll("a[href]")]
                .map(a => (a as HTMLAnchorElement).href)
                .find(h => /\.(mp4|webm|mov)(\?|$)/i.test(h)) ?? "";

            const videoUrl = video?.src || directLink || "";

            const hasMentionEl = !!article.querySelector(`[data-user-id="${me.id}"]`);
            const mentionsMe =
                text.includes(`<@${me.id}>`) ||
                text.includes(`<@!${me.id}>`) ||
                hasMentionEl ||
                myNames.some(n => text.toLowerCase().includes(n.toLowerCase()));

            return {
                listIds: [listId],
                username,
                text,
                embedText,
                normalized: normalize(text),
                videoUrl,
                ageMs,
                mentionsMe,
            };
        })
        .filter(c => {
            if (!c.listIds[0] || !c.videoUrl) return false;

            if (!c.username) {
                console.log("[IF] skipped: username could not be resolved for", c.listIds[0]);
                return false;
            }

            if (c.username !== BOT_USERNAME) return false;
			const fishAbuseEvent = c.embedText.includes("FISH ABUSE EVENT");
			const isForMe = c.mentionsMe;
			const effectiveMaxAge = isForMe ? maxAgeMs : maxAgeMs * 2;
			if (!Number.isFinite(c.ageMs) || c.ageMs < 0 || c.ageMs > effectiveMaxAge) return false;
            if (c.text.includes("is showing off")) return false;


            return true;
        }) as Candidate[]);
}

async function scanForCutscene() {
    if (settings.store.cutsceneMode === "none") { console.log("[IF] scan skipped: cutsceneMode=none"); return; }
    if (activeOverlay) { console.log("[IF] scan skipped: activeOverlay exists"); return; }
    if (bootOverlay) { console.log("[IF] scan skipped: bootOverlay exists"); return; }

    const articles = document.querySelectorAll("div[role='article']");
    console.log("[IF] scanning", articles.length, "articles");

    const candidates = getVisibleCandidates();
    console.log("[IF] candidates after filter:", candidates.length, candidates);

    if (!candidates.length) {
        [...articles].forEach(article => {
            const text = (article.querySelector("[id^='message-content-']") as HTMLElement | null)?.textContent ?? "";
            const username = (article.querySelector("[id^='message-username-']") as HTMLElement | null)?.textContent ?? "";
            const listId = article.getAttribute("data-list-item-id") ?? "";
            const video = article.querySelector("video") as HTMLVideoElement | null;
            const directLink = [...article.querySelectorAll("a[href]")]
                .map(a => (a as HTMLAnchorElement).href)
                .find(h => /\.(mp4|webm|mov)(\?|$)/i.test(h)) ?? "";
            const timeIso = (article.querySelector("time") as HTMLTimeElement | null)?.dateTime ?? "";
            const ageMs = timeIso ? Date.now() - new Date(timeIso).getTime() : Infinity;
            const me = UserStore.getCurrentUser();
            console.log("[IF] article:", {
                listId, username,
                usernameMatch: username === BOT_USERNAME,
                videoSrc: video?.src, directLink, ageMs,
                maxAgeMs: (settings.store.maxAgeSeconds ?? 60) * 1000,
                mentionsMe: me ? (
                    text.includes(`<@${me.id}>`) ||
                    text.includes(`<@!${me.id}>`) ||
                    ["gloomy_tree", "Gloomy Tree", "gloomy tree"].some(n => text.toLowerCase().includes(n.toLowerCase()))
                ) : "no user",
                text: text.slice(0, 80)
            });
        });
        return;
    }

    const newest = candidates[candidates.length - 1];
    console.log("[IF] newest candidate:", newest);

    if (processedListIds.has(newest.listIds[0])) {
        console.log("[IF] skipped: already processed listId", newest.listIds[0]);
        return;
    }
    processedListIds.add(newest.listIds[0]);

    console.log("[IF] triggering overlay for", newest.videoUrl, "mentionsMe:", newest.mentionsMe);

    if (newest.mentionsMe) {
        // Personal cutscene — apply seen-text dedup
        if (settings.store.cutsceneMode === "new") {
            const alreadySeen = await hasSeenSimilarText(newest.normalized);
            if (alreadySeen) {
                console.log("[IF] skipped: already seen similar text");
                return;
            }
        }
        await addSeenText(newest.normalized);
        createOverlay(newest.videoUrl);
	} else {
		if (settings.store.flashbangEnabled) triggerFlashbang();
	}
}

// ─── Boot screen ──────────────────────────────────────────────────────────────

function removeBootOverlay() {
    if (bootOverlay) {
        bootOverlay.remove();
        bootOverlay = null;
    }
}

function showBootScreen() {
    if (!settings.store.bootScreenEnabled) return;
    if (bootOverlay) return;

    const overlay = document.createElement("div");
    overlay.id = "vc-boot-overlay";
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        background: "#000",
        zIndex: "1000000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: "10vh",
        fontFamily: "Roboto Mono, 'Courier New', monospace",
        color: "#c8c8c8",
        opacity: "1",
        transition: "opacity 1.2s ease"
    });

    const logo = document.createElement("img");
    logo.src = logoSrc;
    Object.assign(logo.style, {
        width: "500px",
        height: "500px",
        objectFit: "contain",
        marginBottom: "32px",
        opacity: "0.9"
    });

    const status = document.createElement("div");
    Object.assign(status.style, {
        fontSize: "13px",
        color: "#888",
        marginBottom: "18px",
        letterSpacing: "0.08em",
        minHeight: "18px"
    });
    status.textContent = "Initializing...";

    const barWrap = document.createElement("div");
    Object.assign(barWrap.style, {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontSize: "22px"
    });

    const barOpen = document.createElement("span");
    barOpen.textContent = "[";
    const barFill = document.createElement("span");
    Object.assign(barFill.style, { color: "#e0e0e0" });
    const barEmpty = document.createElement("span");
    Object.assign(barEmpty.style, { color: "#333" });
    const barClose = document.createElement("span");
    barClose.textContent = "]";
    const barPct = document.createElement("span");
    Object.assign(barPct.style, {
        fontSize: "16px",
        color: "#666",
        marginLeft: "8px",
        minWidth: "44px"
    });

    barWrap.appendChild(barOpen);
    barWrap.appendChild(barFill);
    barWrap.appendChild(barEmpty);
    barWrap.appendChild(barClose);
    barWrap.appendChild(barPct);

    overlay.appendChild(logo);
    overlay.appendChild(status);
    overlay.appendChild(barWrap);
    document.body.appendChild(overlay);
    bootOverlay = overlay;

    const stageMessages = [
        { pct: 0,   msg: "Initializing..." },
        { pct: 10,  msg: "Loading kernel modules..." },
        { pct: 22,  msg: "Mounting filesystems..." },
        { pct: 35,  msg: "Starting services..." },
        { pct: 50,  msg: "Establishing uplink..." },
        { pct: 64,  msg: "Decrypting session keys..." },
        { pct: 78,  msg: "Synchronizing data..." },
        { pct: 90,  msg: "Finalizing boot sequence..." },
        { pct: 100, msg: "System ready." }
    ];

    const TOTAL_BLOCKS = 20;
    const blockDelays = [
        80, 120, 180, 250, 400, 520, 480, 350, 300,
        600, 580, 420, 300, 250, 200,
        180, 150, 120, 80, 60
    ];

    let lastStageIdx = -1;

    function updateBar(blocks: number) {
        const pct = Math.round((blocks / TOTAL_BLOCKS) * 100);
        barFill.textContent = "\u2588".repeat(blocks);
        barEmpty.textContent = "\u2591".repeat(TOTAL_BLOCKS - blocks);
        barPct.textContent = `${pct}%`;
        for (let i = stageMessages.length - 1; i >= 0; i--) {
            if (pct >= stageMessages[i].pct) {
                if (lastStageIdx !== i) {
                    lastStageIdx = i;
                    status.textContent = stageMessages[i].msg;
                }
                break;
            }
        }
    }

    updateBar(0);

    let elapsed = 0;
    for (let i = 0; i < TOTAL_BLOCKS; i++) {
        elapsed += blockDelays[i] ?? 100;
        const blockCount = i + 1;
        setTimeout(() => updateBar(blockCount), elapsed);
    }

    const afterBar = elapsed + 200;
    setTimeout(() => {
        status.textContent = "\u25a0 BOOT COMPLETE";
        status.style.color = "#aaa";

        const startupAudio = new Audio(startupSrc);
        startupAudio.volume = (settings.store.bgmVolume ?? 35) / 100;

        let fadeOutFired = false;
        const doFadeOut = () => {
            if (fadeOutFired || !bootOverlay) return;
            fadeOutFired = true;
            bootOverlay.style.opacity = "0";
            setTimeout(() => {
                removeBootOverlay();
                if (settings.store.bgmEnabled) void startBGM(true);
            }, 1200);
        };

        const hardCap = setTimeout(doFadeOut, 15000);

        startupAudio.addEventListener("loadedmetadata", () => {
            // Start fade 1200ms before the audio ends so they finish together
            const fadeDelay = Math.max(0, (startupAudio.duration * 1000) - 10000);
            setTimeout(doFadeOut, fadeDelay);
        }, { once: true });

        // If metadata never loads (common with base64 in Electron), fall back to fixed delay
        startupAudio.addEventListener("durationchange", () => {
            if (isFinite(startupAudio.duration)) {
                const fadeDelay = Math.max(0, (startupAudio.duration * 1000) - 10000);
                setTimeout(doFadeOut, fadeDelay);
            }
        }, { once: true });

        startupAudio.play()
            .then(() => clearTimeout(hardCap))
            .catch(() => { clearTimeout(hardCap); doFadeOut(); });
    }, afterBar);
}

// ─── Plugin lifecycle ─────────────────────────────────────────────────────────

function startPlugin() {
    processedListIds = new Set();
    lastTickInterval = settings.store.tickInterval || 80;
    injectSettingsButton();
    // Apply the selected theme (injects CSS + starts theme effects)
    applyTheme(settings.store.activeTheme as ThemeId ?? "illusion");

    // MutationObserver wraps new elements for flicker (only active if illusion theme)
    flickerObserver = new MutationObserver(mutations => {
        if (settings.store.activeTheme !== "illusion") return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;

                if (node.matches(FLICKER_TEXT_CONTAINERS) && !shouldSkipFlicker(node)) {
                    wrapLetters(node);
                }

                node.querySelectorAll(FLICKER_TEXT_CONTAINERS).forEach(el => {
                    if (!shouldSkipFlicker(el)) wrapLetters(el);
                });
            }
        }
    });

    flickerObserver.observe(document.body, { childList: true, subtree: true });

    cutsceneScanTimer = setInterval(() => {
        syncBGMVolume();
        void scanForCutscene();
    }, CUTSCENE_SCAN_INTERVAL_MS);
}

function stopPlugin() {
    stopFlickerLoop();
    stopZilchGlowLoop();
	flashbangOverlay?.remove();
	flashbangOverlay = null;
	document.getElementById("vc-puppetlink-settings-btn")?.remove();
    if (cutsceneScanTimer) {
        clearInterval(cutsceneScanTimer);
        cutsceneScanTimer = null;
    }

    if (flickerObserver) {
        flickerObserver.disconnect();
        flickerObserver = null;
    }

    unwrapAllLetters();
    removeThemeCSS();
    processedListIds.clear();
    closeOverlay();
    stopBGM();
    removeBgmUnlockBanner();
    removeBootOverlay();
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "PuppetLink",
    description: "Official plug-in for illusion discord server, auto cutscene, special font animation, BGM player",
    authors: [{ name: "Gloomy Tree", id: 320502924830834689n }],
    settings,

    start() {
        showBootScreen();
        setTimeout(startPlugin, 1500);
    },

    stop() {
        stopPlugin();
    }
});
