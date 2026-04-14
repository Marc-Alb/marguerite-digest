// Fetch le digest marketing du jour depuis Notion,
// le fait adapter en version orale par Claude, ecrit digest.txt.

import { Client as NotionClient } from "@notionhq/client";
import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";

const notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic();

// --- Diagnostic identite du token ---
try {
  const me = await notion.users.me();
  console.log(`[DEBUG] Token identite : bot="${me.name}", workspace="${me.bot?.workspace_name}", owner_type="${me.bot?.owner?.type}"`);
} catch (e) {
  console.log(`[DEBUG] Impossible de lire users.me : ${e.message}`);
}

// --- 1. Chercher la page du digest le plus recent via search API ---

function getTitle(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === "title") {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return "";
}

const search = await notion.search({
  query: "Digest marketing quotidien",
  filter: { property: "object", value: "page" },
  sort: { direction: "descending", timestamp: "last_edited_time" },
  page_size: 10,
});

const candidates = search.results.filter((page) => {
  const title = getTitle(page).toLowerCase();
  return title.includes("digest") && title.includes("marketing");
});

if (candidates.length === 0) {
  console.log("[DEBUG] Recherche 'Digest marketing quotidien' : 0 resultats. Liste complete de ce que l'integration peut voir :");
  const all = await notion.search({ page_size: 30 });
  console.log(`[DEBUG] ${all.results.length} objets accessibles :`);
  for (const r of all.results.slice(0, 30)) {
    console.log(`  - ${r.object}: "${getTitle(r) || r.title?.[0]?.plain_text || '(sans titre)'}" id=${r.id}`);
  }
  throw new Error("Aucun digest marketing trouve. Verifie que la DB 'Centre de documents' est bien connectee a l'integration marguerite-digest-podcast.");
}

// Prendre le plus recent par created_time (priorite au dernier ecrit, pas au dernier modifie)
candidates.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));
const digestPage = candidates[0];
const digestTitle = getTitle(digestPage);
const createdAt = new Date(digestPage.created_time);
console.log(`[Notion] Digest trouve : "${digestTitle}" (cree le ${createdAt.toLocaleString("fr-FR")})`);

// --- 2. Extraire le texte de la page (recursif sur les blocks) ---

async function extractText(blockId, depth = 0) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  let text = "";
  for (const block of blocks) {
    const type = block.type;
    const data = block[type];
    if (data?.rich_text) {
      const line = data.rich_text.map((r) => r.plain_text).join("");
      if (line.trim()) {
        const prefix = type.startsWith("heading") ? "\n## " : "";
        text += prefix + line + "\n";
      }
    }
    if (type === "table_row" && data?.cells) {
      text += data.cells.map((c) => c.map((r) => r.plain_text).join("")).join(" | ") + "\n";
    }
    if (block.has_children && type !== "child_page") {
      text += await extractText(block.id, depth + 1);
    }
  }
  return text;
}

const digestMarkdown = (await extractText(digestPage.id)).trim();
console.log(`[Notion] Texte extrait : ${digestMarkdown.length} caracteres, ${digestMarkdown.split(/\s+/).length} mots`);

// --- 3. Adapter en version orale via Claude ---

const today = new Date().toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const systemPrompt = `Tu es Marguerite, agente marketing de Tandem Studio. Tu produis le briefing audio matinal de Marc a partir de ton propre digest ecrit dans Notion.

Ta mission : transformer ce digest complet en briefing oral (2-3 minutes d'ecoute) que Marc va ecouter dans son casque.

Regles strictes de forme :
- Longueur cible : 350-450 mots (2-3 minutes parle).
- ECRITURE ORALE : pas de bullets, pas de 'premierement/deuxiemement/enfin', pas de tableaux, pas de liens, pas de listes de sources. Phrases courtes, transitions naturelles ("l'autre truc", "par ailleurs", "cote X"), ponctuation qui guide le souffle.
- Ton : toi-meme (Marguerite), authentique indie, tutoie Marc, jamais corporate.
- Selection : garde les 3-4 items les plus actionnables du jour (urgence Haute > Moyenne, impact Haut > Moyen). Ignore Effort/Impact faible.
- Zappe : historique des revisions, sources consultees, synthese tabulaire finale, corrections de memoire interne, meta-notes.
- Garde les dates absolues, noms de festivals/subreddits precis, montants.
- Ouvre avec une phrase contextuelle courte et personnelle. Termine par une phrase de cloture motivante.

Reponds UNIQUEMENT avec le texte oral a lire. Pas de titre, pas de meta-commentaire, pas d'indications scenique. Ce texte ira directement au TTS.`;

const userPrompt = `Voici ton digest complet pour le ${today}. Adapte-le en briefing oral 2-3 min pour Marc.\n\n---\n\n${digestMarkdown}`;

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
