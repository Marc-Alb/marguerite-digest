// Lit le digest du jour depuis digest-latest.md (commit par Marguerite la veille au soir),
// le fait adapter en version orale par Claude, ecrit digest.txt.

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, stat } from "node:fs/promises";

const anthropic = new Anthropic();
const SOURCE_FILE = "digest-latest.md";

// --- 1. Lire le digest source ---

let source;
try {
  source = await readFile(SOURCE_FILE, "utf8");
} catch (e) {
  throw new Error(`Fichier ${SOURCE_FILE} introuvable dans le repo. Marguerite ne l'a pas commit hier soir. Details: ${e.message}`);
}

const fileStat = await stat(SOURCE_FILE);
const ageHours = (Date.now() - fileStat.mtimeMs) / 1000 / 3600;
console.log(`[Source] ${SOURCE_FILE} lu : ${source.length} caracteres, ${source.split(/\s+/).length} mots, modifie il y a ${ageHours.toFixed(1)}h`);

if (ageHours > 36) {
  console.warn(`[WARN] Le digest a plus de 36h. Marguerite n'a peut-etre pas publie hier soir. On continue quand meme.`);
}

// --- 2. Adapter en version orale via Claude ---

const today = new Date().toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const systemPrompt = `Tu es Marguerite, agente marketing de Tandem Studio. Tu produis le briefing audio matinal de Marc a partir de ton propre digest ecrit la veille au soir.

Ta mission : transformer ce digest complet en briefing oral (2-3 minutes d'ecoute) que Marc va ecouter dans son casque.

Regles strictes de forme :
- Longueur cible : 350-450 mots (2-3 minutes parle).
- ECRITURE ORALE : pas de bullets, pas de 'premierement/deuxiemement/enfin', pas de tableaux, pas de liens, pas de listes de sources. Phrases courtes, transitions naturelles ("l'autre truc", "par ailleurs", "cote X"), ponctuation qui guide le souffle.
- Ton : toi-meme (Marguerite), authentique indie, tutoie Marc, jamais corporate.
- Selection : garde les 3-4 items les plus actionnables du jour (urgence Haute > Moyenne, impact Haut > Moyen). Ignore Effort/Impact faible.
- Zappe : historique des revisions, sources consultees, synthese tabulaire, corrections de memoire interne, meta-notes.
- Garde les dates absolues, noms de festivals/subreddits precis, montants.
- Ouvre avec une phrase contextuelle courte et personnelle. Termine par une phrase de cloture motivante.

Reponds UNIQUEMENT avec le texte oral a lire. Pas de titre, pas de meta-commentaire, pas d'indications scenique. Ce texte ira directement au TTS.`;

const userPrompt = `Voici ton digest complet pour le ${today}. Adapte-le en briefing oral 2-3 min pour Marc.\n\n---\n\n${source}`;

const msg = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2000,
  system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: userPrompt }],
});

const oralText = msg.content.find((b) => b.type === "text").text.trim();
await writeFile("digest.txt", oralText, "utf8");

console.log(`[OK] Digest oral ecrit : ${oralText.split(/\s+/).length} mots, ${oralText.length} caracteres`);
console.log(`[Tokens] input=${msg.usage.input_tokens}, output=${msg.usage.output_tokens}, cache_creation=${msg.usage.cache_creation_input_tokens || 0}, cache_read=${msg.usage.cache_read_input_tokens || 0}`);
