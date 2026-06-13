# IllusionaryFusion

A [Vencord](https://github.com/Vendicated/Vencord) plugin that combines three features into one immersive Discord experience for the illusion discord server : a glitch letter flicker effect on all messages replicating the illusioanry aura font effect, automatic bot-triggered cutscene overlays, and optional looping background music with a fake boot screen on startup to replicate puppet link ambience.

---

## Features

### 🔤 Glitch Letter Flicker
All message text in Discord gets wrapped letter-by-letter and randomly flickers to a configurable color with a neon glow effect. Fully configurable tick rate, flicker chance, hold duration, and color.

### 🎬 Automatic Cutscene Overlay
Monitors messages from a specific bot. When the bot sends a video attachment and mentions your display name, a fullscreen overlay plays the video automatically. Supports skip (button or `Escape`), a "Play cutscene" fallback if autoplay is blocked, and three trigger modes.

### 🎵 Looping Background Music
Optional BGM that loops while Discord is open. Handles Chromium's autoplay policy gracefully — shows a banner prompting a single click to unlock audio if needed. Volume is configurable. BGM automatically mutes during cutscene playback and fades back in when the cutscene ends.

### 💻 Boot Screen
A fake terminal boot sequence plays on Discord startup — logo, animated progress bar with uneven pacing, stage status messages, and a startup sound. Fades out and starts BGM automatically when complete.

---

## Installation

This is a **userplugin** — it lives in your local Vencord source tree and is not distributed through the plugin store.

**Prerequisites:** [Vencord development environment](https://docs.vencord.dev/installing/custom-plugins/) set up and working.

### 1. Clone or copy the plugin

Place the plugin folder into your Vencord userplugins directory:

```
src/userplugins/IllusionaryFusion/
├── index.ts
├── assets/
│   ├── bgm.mp3        ← your looping BGM track
│   ├── startup.mp3    ← your boot screen jingle
│   └── LoadingIcon.png ← your boot screen logo
├── bgmData.ts         ← can be generated (see below)
├── startupData.ts     ← can be generated (see below)
└── logoData.ts        ← can be generated (see below)
```

### 2. Generate asset data files

Because esbuild (used by Vencord) has no loader for binary assets, audio and image files are base64-inlined at build time. Run these three commands from inside the `IllusionaryFusion/` folder:

```bash
node -e "const fs=require('fs');const b64=fs.readFileSync('./assets/bgm.mp3').toString('base64');fs.writeFileSync('./bgmData.ts','export default \"data:audio/mp3;base64,'+b64+'\";\n');"

node -e "const fs=require('fs');const b64=fs.readFileSync('./assets/startup.mp3').toString('base64');fs.writeFileSync('./startupData.ts','export default \"data:audio/mp3;base64,'+b64+'\";\n');"

node -e "const fs=require('fs');const b64=fs.readFileSync('./assets/LoadingIcon.png').toString('base64');fs.writeFileSync('./logoData.ts','export default \"data:image/png;base64,'+b64+'\";\n');"
```

Re-run these whenever you swap out an asset file.

### 3. Build Vencord

```bash
pnpm build
```

Then inject as usual (`pnpm inject` or your preferred method).

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `flickerEnabled` | Boolean | `true` | Enable/disable the letter flicker effect |
| `flickerColor` | String (hex) | `#0302d2` | Color letters flicker to |
| `tickInterval` | Slider (ms) | `80` | How often the flicker ticks — lower = more chaotic |
| `flickerChance` | Slider | `4` | Probability a letter flickers per tick |
| `holdDuration` | Slider (ms) | `120` | How long a letter holds the flicker color |
| `cutsceneMode` | Select | `all` | `all` = every bot video, `new` = unseen only, `none` = disabled |
| `maxAgeSeconds` | Slider (s) | `60` | Ignore bot messages older than this |
| `bootScreenEnabled` | Boolean | `true` | Show the fake boot sequence on startup |
| `bgmEnabled` | Boolean | `false` | Enable looping background music |
| `bgmVolume` | Slider (%) | `35` | Volume for both BGM and startup sound |

---

## How the Cutscene Trigger Works

1. Every 750ms, the plugin scans all visible `div[role='article']` elements.
2. A message qualifies if:
   - It was sent by the configured bot username (`BOT_USERNAME` constant in `index.ts`)
   - It contains a `.mp4`, `.webm`, or `.mov` attachment (via `<video>` element or direct link)
   - Its timestamp is within `maxAgeSeconds`
   - It mentions your Discord display name or user ID
3. The most recent qualifying message that hasn't been processed yet triggers the fullscreen overlay.
4. In `new` mode, a normalized similarity hash is stored via `DataStore` so already-seen cutscenes don't replay across sessions.

---

## Customization

### Change the bot username
Edit the constant at the top of `index.ts`:
```ts
const BOT_USERNAME = "Your Bot NameAPP";
```
Copy the exact string shown in the Discord UI (including any suffixes like `APP`).

### Change boot screen timing
The `blockDelays` array in `showBootScreen()` controls the pacing of the progress bar — each entry is the delay in ms before that block fills in. Edit the 20 values to taste.

### Change boot screen position
The `paddingBottom` value in the overlay style controls vertical position:
```ts
paddingBottom: "10vh",  // increase to move up, decrease to move down
```

---

## File Size Notes

The generated `*Data.ts` files are large — roughly 1.33× the size of the source asset. Keep assets reasonably sized:

| Asset | Recommended max |
|---|---|
| `bgm.mp3` | ~4 MB |
| `startup.mp3` | ~1 MB |
| `LoadingIcon.png` | ~512 KB |

Larger files will bloat the Vencord bundle and slow build times.

---

## License

GPL-3.0-or-later — same as Vencord.
