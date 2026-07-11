import type { Market, RankedMarket } from "./types.js";

const CONCEPTS: Record<string, string[]> = {
  nuclear: ["uranium", "reactor", "energy", "electricity", "power plant", "enrichment"],
  uranium: ["nuclear", "energy", "reactor", "mining"],
  ai: ["artificial intelligence", "chips", "semiconductor", "nvidia", "data center", "electricity"],
  crypto: ["bitcoin", "ethereum", "blockchain", "stablecoin", "coinbase"],
  oil: ["energy", "crude", "opec", "inflation", "middle east"],
  stocks: ["equities", "s&p", "nasdaq", "dow", "recession", "rates"],
  rates: ["fed", "interest", "inflation", "treasury", "fomc"],
  defense: ["war", "military", "geopolitics", "nato", "weapons"],
  climate: ["weather", "temperature", "carbon", "hurricane", "energy"],
  china: ["chinese", "beijing", "south china sea", "taiwan", "philippines", "coast guard", "maritime", "pla"],
  indonesia: ["indonesian", "natuna", "asean", "south china sea", "maritime"],
  fishing: ["fish", "fisheries", "seafood", "trawler", "vessel", "ocean", "maritime"],
  fisherman: ["fishing", "fish", "fisheries", "seafood", "maritime"],
  maritime: ["sea", "navy", "shipping", "strait", "coast guard", "vessel"],
  conflict: ["war", "military", "clash", "invasion", "dispute", "geopolitics"],
};

const STOP = new Set("a am an and are as at be been by can could do does for from had has have how i if in into is it may might my nearby of on only or our relevant should that the their them there these they this to user was were what when where which who why will with would you your exposure context downside adverse scenario scenarios amount reducing capture come coming enter entering make trade trades hedge hedging consider".split(" "));

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOP.has(token)) ?? [];
}

function expandedQuery(query: string): { base: string[]; terms: string[]; concepts: string[] } {
  const base = tokens(query);
  const concepts = Object.keys(CONCEPTS).filter((concept) => {
    const aliases = [concept, ...CONCEPTS[concept]!.flatMap(tokens)];
    return aliases.some((alias) => base.includes(alias));
  });
  const expanded = concepts.flatMap((concept) => CONCEPTS[concept]!.flatMap(tokens));
  return { base: [...new Set(base)], terms: [...new Set([...base, ...expanded])], concepts };
}

function localEvidence(query: string, markets: Market[]) {
  const { base, terms, concepts } = expandedQuery(query);
  const documents = markets.map((market) => tokens(`${market.title} ${market.title} ${market.description}`));
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(term, documents.filter((document) => document.includes(term)).length);
  }
  return documents.map((document, index) => {
    const frequencies = new Map<string, number>();
    for (const token of document) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const tf = frequencies.get(term) ?? 0;
      const idf = Math.log((markets.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
      score += Math.log1p(tf) * idf;
    }
    const documentSet = new Set(document);
    const matchedBase = base.filter((term) => documentSet.has(term));
    const matchedTerms = terms.filter((term) => documentSet.has(term));
    const matchedConcepts = concepts.filter((concept) =>
      [concept, ...CONCEPTS[concept]!].flatMap(tokens).some((term) => documentSet.has(term)),
    );
    const expandedMatches = matchedTerms.filter((term) => !base.includes(term)).length;
    const eligible = matchedBase.length >= 2
      || (matchedBase.length >= 1 && (expandedMatches >= 1 || base.length <= 2))
      || (matchedConcepts.length >= 1 && expandedMatches >= 2);
    const liquidityBoost = eligible
      ? Math.log10(1 + markets[index]!.liquidity + markets[index]!.volume * 0.05) / 40
      : 0;
    return { score: eligible ? score + liquidityBoost : 0, eligible, matchedTerms, matchedConcepts };
  });
}

async function embeddingScores(query: string, markets: Market[]): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || markets.length === 0) return null;
  const inputs = [query, ...markets.map((market) => `${market.title}\n${market.description}`.slice(0, 4000))];
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small", input: inputs }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { data: Array<{ embedding: number[] }> };
  const queryVector = payload.data[0]?.embedding;
  if (!queryVector) return null;
  const norm = (vector: number[]) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  const queryNorm = norm(queryVector);
  return payload.data.slice(1).map(({ embedding }) => {
    const dot = embedding.reduce((sum, value, index) => sum + value * (queryVector[index] ?? 0), 0);
    return dot / (queryNorm * norm(embedding) || 1);
  });
}

export async function rankMarkets(query: string, markets: Market[], limit: number): Promise<{ results: RankedMarket[]; mode: string }> {
  const semantic = await embeddingScores(query, markets).catch(() => null);
  const evidence = localEvidence(query, markets);
  const ranked = markets
    .map((market, index) => ({
      ...market,
      relevance: Number(((semantic?.[index] ?? evidence[index]?.score ?? 0)).toFixed(4)),
      matchedConcepts: evidence[index]?.matchedConcepts ?? [],
      matchedTerms: evidence[index]?.matchedTerms ?? [],
      eligible: evidence[index]?.eligible ?? false,
    }))
    .filter((market) => market.eligible)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map(({ eligible: _eligible, ...market }) => market);
  return { results: ranked, mode: semantic ? "openai-embeddings" : "local-concept-bm25" };
}
