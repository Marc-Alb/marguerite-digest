// generate.js — Transforme un texte de digest en episode de podcast.
//
// Usage :
//   node generate.js --title "Digest 14 avril" --text-file digest.txt
//   echo "Bonjour Marc..." | node generate.js --title "Digest 14 avril"
//
// Config par variables d'env (voir .env.example) :
//   PODCAST_BASE_URL   URL publique ou sera servi le dossier podcast/ (GitHub Pages)
//   PODCAST_VOICE      Voix Edge (defaut : fr-FR-DeniseNeural)
//   PODCAST_RATE       Vitesse, ex : "+0%", "+10%" (defaut : "+0%")

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PODCAST_DIR = __dirname;
const EPISODES_DIR = join(PODCAST_DIR, "episodes");
const FEED_PATH = join(PODCAST_DIR, "feed.xml");

const BASE_URL = (process.env.PODCAST_BASE_URL || "https://CHANGE_ME.github.io/marguerite-digest").replace(/\/$/, "");
const VOICE = process.env.PODCAST_VOICE || "fr-FR-DeniseNeural";
const RATE = process.env.PODCAST_RATE || "+0%";

// --- CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { title: null, textFile: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title") out.title = args[++i];
    else if (args[i] === "--text-file") out.textFile = args[++i];
  }
  return out;
}

async function readText(textFile) {
  if (textFile) return (await readFile(textFile, "utf8")).trim();
  // sinon stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pad(n) { return String(n).padStart(2, "0"); }
function rfc2822(d) {
  return d.toUTCString();
}
function slugDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function synthesize(text, outPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, { rate: RATE });
  await new Promise((resolve, reject) => {
    const out = audioStream.pipe(createWriteStream(outPath));
    out.once("close", () => (out.bytesWritten > 0 ? resolve() : reject(new Error("No audio data"))));
    out.once("error", reject);
  });
  tts.close();
  return outPath;
}

async function loadEpisodes() {
  const path = join(PODCAST_DIR, "episodes.json");
  if (!existsSync(path)) return [];
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveEpisodes(episodes) {
  await writeFile(join(PODCAST_DIR, "episodes.json"), JSON.stringify(episodes, null, 2));
}

function buildFeed(episodes) {
  const now = rfc2822(new Date());
  const items = episodes
    .slice()
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .map((ep) => `
    <item>
      <title>${xmlEscape(ep.title)}</title>
      <description>${xmlEscape(ep.description || ep.title)}</description>
      <pubDate>${ep.pubDate}</pubDate>
      <guid isPermaLink="false">${ep.guid}</guid>
      <enclosure url="${xmlEscape(ep.url)}" length="${ep.size}" type="audio/mpeg"/>
      <itunes:duration>${ep.duration || "00:01:00"}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Digest Marketing — Tandem Studio</title>
    <link>${BASE_URL}</link>
    <language>fr-FR</language>
    <description>Digest marketing quotidien de Marguerite pour Tandem Studio.</description>
    <itunes:author>Marguerite (Tandem Studio)</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Business"/>
    <itunes:image href="${BASE_URL}/cover.png"/>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${now}</lastBuildDate>${items}
  </channel>
</rss>
`;
}

async function main() {
  const { title, textFile } = parseArgs();
  const text = await readText(textFile);
  if (!text) throw new Error("Aucun texte fourni (stdin ou --text-file).");
  const now = new Date();
  const finalTitle = title || `Digest ${now.toLocaleDateString("fr-FR")}`;
  const slug = slugDate(now);
  const mp3Name = `${slug}.mp3`;
  const mp3Path = join(EPISODES_DIR, mp3Name);

  await mkdir(EPISODES_DIR, { recursive: true });
  console.log(`[TTS] Generation audio (${VOICE}) -> ${mp3Name}`);
  await synthesize(text, mp3Path);
  const { size } = await stat(mp3Path);

  const episode = {
    title: finalTitle,
    description: text.slice(0, 300),
    pubDate: rfc2822(now),
    guid: slug,
    url: `${BASE_URL}/episodes/${mp3Name}`,
    size,
  };

  const episodes = await loadEpisodes();
  episodes.push(episode);
  await saveEpisodes(episodes);
  await writeFile(FEED_PATH, buildFeed(episodes));

  console.log(`[OK] Episode ajoute : ${mp3Path}`);
  console.log(`[OK] Feed mis a jour : ${FEED_PATH}`);
  console.log(`\nProchaine etape : cd podcast && git add . && git commit -m "${finalTitle}" && git push`);
}

main().catch((e) => { console.error(e); process.exit(1); });
