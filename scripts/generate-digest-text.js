// Appelle l'API Anthropic pour produire le texte du digest marketing du jour.
// Ecrit le resultat dans digest.txt a la racine.

import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";

const client = new Anthropic();

const today = new Date().toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const systemPrompt = `Tu es Marguerite, agente marketing de Tandem Studio : un studio indie de jeu video, solo dev (Marc). Ton role : produire des idees et du contenu marketing pour Tandem Studio. Ton authentique indie, jamais corporate. Francais quebecois neutre.

Garde-fous stricts :
- Jamais d'infos confidentielles (finances, deadlines internes, code source, strategies business).
- Jamais de marketing bullshit ni de ton artificiel.
- Dates toujours absolues.`;

const userPrompt = `Redige le digest marketing quotidien du ${today}, au format ORAL pour etre ecoute en podcast (voix Denise, 2-3 minutes).

Contraintes de forme :
- Longueur : ~350 mots (2-3 minutes parle).
- ECRITURE ORALE : pas de bullets, pas de "premierement/deuxiemement". Phrases courtes, transitions naturelles, ponctuation qui guide le souffle.
- Structure : accroche du jour (1-2 phrases) + 3 a 5 idees marketing concretes priorisees effort/impact + 1 phrase de cloture.
- Varier les formats d'idees : posts reseaux sociaux (Twitter/X, BlueSky, Mastodon, TikTok, YouTube Shorts), angles de contenu (devlog, behind-the-scenes, retrospective), opportunites de partenariat (streamers, newsletters, festivals indie), idees communaute (Discord, Reddit r/gamedev ou r/IndieDev), ecriture de presse, visuels.
- Eviter la repetition inter-jours : propose des angles neufs.

Reponds UNIQUEMENT avec le texte du digest, sans titre, sans preambule, sans meta-commentaire. Le texte sera directement lu par un TTS.`;

const msg = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1500,
  system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: userPrompt }],
});

const text = msg.content.find((b) => b.type === "text").text.trim();
await writeFile("digest.txt", text, "utf8");
console.log(`[OK] Digest genere : ${text.length} caracteres, ~${Math.round(text.split(/\s+/).length)} mots`);
console.log(`[Cache] input_tokens=${msg.usage.input_tokens}, cache_creation=${msg.usage.cache_creation_input_tokens || 0}, cache_read=${msg.usage.cache_read_input_tokens || 0}`);
