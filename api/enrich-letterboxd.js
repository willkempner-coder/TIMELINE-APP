const TMDB_PRIORITY_GENRE_IDS = new Set([99, 36, 10752]);
const TMDB_PRIORITY_GENRE_NAMES = new Set(["Documentary", "History", "War"]);

const GENRE_CANONICAL_ALIASES = new Map([
  ["documentary film", "Documentary"],
  ["doc film", "Documentary"],
  ["documentaries", "Documentary"],
  ["biographical film", "Biography"],
  ["biography film", "Biography"],
  ["biographical drama", "Biography"],
  ["biopic", "Biography"],
  ["biopics", "Biography"],
  ["history film", "History"],
  ["historical film", "History"],
  ["historic film", "History"],
  ["war film", "War"],
  ["war movie", "War"],
  ["science fiction", "Sci-Fi"],
  ["sci fi", "Sci-Fi"],
  ["sci-fi", "Sci-Fi"]
]);

const WIKIDATA_FILM_LIKE_QIDS = new Set([
  "Q11424",
  "Q24869",
  "Q202866",
  "Q5398426",
  "Q506240",
  "Q21191270"
]);

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizeLetterboxdUri(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://letterboxd.com${raw}`;
  return `https://letterboxd.com/${raw.replace(/^\/+/, "")}`;
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeGenreName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = GENRE_CANONICAL_ALIASES.get(raw.toLowerCase());
  if (direct) return direct;
  return raw
    .split(/\s+/)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(" ");
}

function normalizeGenreList(genres) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(genres) ? genres : []) {
    const genre = canonicalizeGenreName(item);
    if (!genre || seen.has(genre)) continue;
    seen.add(genre);
    out.push(genre);
  }
  return out;
}

async function fetchText(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractAttributeTexts(content, attribute) {
  const html = String(content || "");
  if (!html) return [];
  const out = [];

  const anchorRegex = new RegExp(`<a[^>]*href=["'][^"']*/${attribute}/[^"']*["'][^>]*>(.*?)<\\/a>`, "gi");
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const value = cleanText(match[1]);
    if (value) out.push(value);
  }
  if (out.length > 0) return Array.from(new Set(out));

  const mdRegex = new RegExp(`\\[([^\\]]+)\\]\\([^\\)]*/${attribute}/[^\\)]*\\)`, "gi");
  while ((match = mdRegex.exec(html)) !== null) {
    const value = cleanText(match[1]);
    if (value) out.push(value);
  }
  return Array.from(new Set(out));
}

async function fetchLetterboxdPageMeta(letterboxdUri) {
  const url = normalizeLetterboxdUri(letterboxdUri);
  if (!url) return null;

  const html = await fetchText(url, 6000);
  if (!html) return null;

  const genres = normalizeGenreList(extractAttributeTexts(html, "genre"));
  const directors = extractAttributeTexts(html, "director");
  const director = directors[0] || "";

  if (!director && genres.length === 0) return null;
  return {
    genres,
    director,
    isPriority: genres.some((name) => TMDB_PRIORITY_GENRE_NAMES.has(name)),
    source: "letterboxd-page"
  };
}

function parseWikidataTime(value) {
  const raw = value?.time;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^([+-])(\d{1,6})-/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(match[2]);
}

function collectWikidataLinkedIds(claims, property) {
  const statements = claims?.[property];
  if (!Array.isArray(statements)) return [];
  const ids = [];
  for (const statement of statements) {
    const id = statement?.mainsnak?.datavalue?.value?.id;
    if (typeof id === "string" && id.startsWith("Q")) ids.push(id);
  }
  return ids;
}

function pickWikidataClaimYear(claims, property) {
  const statements = claims?.[property];
  if (!Array.isArray(statements)) return null;
  for (const statement of statements) {
    const parsed = parseWikidataTime(statement?.mainsnak?.datavalue?.value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isLikelyFilmOrTvEntity(claims) {
  const instanceIds = collectWikidataLinkedIds(claims, "P31");
  return instanceIds.some((id) => WIKIDATA_FILM_LIKE_QIDS.has(id));
}

async function fetchWikidataFilmMeta(title, year) {
  try {
    const searchParams = new URLSearchParams({
      action: "wbsearchentities",
      search: title,
      language: "en",
      format: "json",
      origin: "*",
      type: "item",
      limit: "6"
    });
    const search = await fetchJson(`https://www.wikidata.org/w/api.php?${searchParams.toString()}`);
    const candidates = Array.isArray(search?.search) ? search.search : [];
    if (candidates.length === 0) return null;

    const ids = candidates.map((item) => item.id).filter(Boolean);
    const entityParams = new URLSearchParams({
      action: "wbgetentities",
      ids: ids.join("|"),
      props: "claims|labels",
      languages: "en",
      format: "json",
      origin: "*"
    });
    const entityRes = await fetchJson(`https://www.wikidata.org/w/api.php?${entityParams.toString()}`);
    const entities = ids.map((id) => entityRes?.entities?.[id]).filter((entity) => entity?.claims);
    if (entities.length === 0) return null;

    const needle = String(title || "").trim().toLowerCase();
    let best = null;
    let bestScore = -Infinity;
    for (const entity of entities) {
      const label = String(entity?.labels?.en?.value || "").trim().toLowerCase();
      const claims = entity.claims || {};
      const publicationYear = pickWikidataClaimYear(claims, "P577");
      let score = 0;
      if (label && needle && label === needle) score += 4;
      else if (label && needle && (label.includes(needle) || needle.includes(label))) score += 2;
      if (isLikelyFilmOrTvEntity(claims)) score += 3;
      if (Number.isFinite(year) && Number.isFinite(publicationYear)) {
        const diff = Math.abs(publicationYear - year);
        score += Math.max(0, 2 - diff * 0.25);
      }
      if (score > bestScore) {
        best = entity;
        bestScore = score;
      }
    }
    if (!best?.claims) return null;

    const genreIds = collectWikidataLinkedIds(best.claims, "P136").slice(0, 8);
    const directorIds = collectWikidataLinkedIds(best.claims, "P57").slice(0, 2);
    const labelIds = Array.from(new Set([...genreIds, ...directorIds]));
    if (labelIds.length === 0) return null;

    const labelsParams = new URLSearchParams({
      action: "wbgetentities",
      ids: labelIds.join("|"),
      props: "labels",
      languages: "en",
      format: "json",
      origin: "*"
    });
    const labelsRes = await fetchJson(`https://www.wikidata.org/w/api.php?${labelsParams.toString()}`);
    const genres = normalizeGenreList(genreIds.map((id) => labelsRes?.entities?.[id]?.labels?.en?.value).filter(Boolean));
    const director = directorIds.map((id) => labelsRes?.entities?.[id]?.labels?.en?.value).find(Boolean) || "";
    if (!director && genres.length === 0) return null;
    return {
      genres,
      director,
      isPriority: genres.some((name) => TMDB_PRIORITY_GENRE_NAMES.has(name)),
      source: "wikidata"
    };
  } catch {
    return null;
  }
}

async function fetchTmdbFilmMeta(title, year) {
  const tmdbKey = process.env.TMDB_API_KEY || process.env.VITE_TMDB_API_KEY || "";
  if (!tmdbKey) return null;
  try {
    const searchParams = new URLSearchParams({
      api_key: tmdbKey,
      query: title,
      language: "en-US",
      include_adult: "false"
    });
    if (year) searchParams.set("year", String(year));
    const search = await fetchJson(`https://api.themoviedb.org/3/search/movie?${searchParams.toString()}`);
    const result = search?.results?.[0];
    if (!result?.id) return null;

    const detailParams = new URLSearchParams({
      api_key: tmdbKey,
      language: "en-US",
      append_to_response: "credits"
    });
    const detail = await fetchJson(`https://api.themoviedb.org/3/movie/${result.id}?${detailParams.toString()}`);
    if (!detail) return null;

    const genres = normalizeGenreList((detail.genres || []).map((g) => g.name));
    const director = detail.credits?.crew?.find((crew) => crew.job === "Director")?.name || "";
    const isPriority = (detail.genres || []).some((g) => TMDB_PRIORITY_GENRE_IDS.has(g.id));
    return { genres, director, isPriority, source: "tmdb" };
  } catch {
    return null;
  }
}

async function enrichOne(item, cache) {
  const key = `${String(item.title || "").toLowerCase()}|${item.productionStart || ""}|${normalizeLetterboxdUri(item.letterboxdUri || "")}`;
  if (cache.has(key)) {
    return { index: item.index, ...cache.get(key) };
  }

  let meta = await fetchLetterboxdPageMeta(item.letterboxdUri);
  if (!meta) meta = await fetchWikidataFilmMeta(item.title, item.productionStart);
  if (!meta) meta = await fetchTmdbFilmMeta(item.title, item.productionStart);
  if (!meta) meta = { genres: [], director: "", isPriority: false, source: "none" };

  cache.set(key, meta);
  return { index: item.index, ...meta };
}

async function runWithConcurrency(items, limit = 16) {
  const out = new Array(items.length);
  const cache = new Map();
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await enrichOne(items[index], cache);
    }
  }

  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

export default async function handler(req, res) {
  withCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: "No items provided" });

  const sanitized = items.map((item, index) => ({
    index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index,
    title: String(item?.title || "").trim(),
    productionStart: Number.isFinite(Number(item?.productionStart)) ? Number(item.productionStart) : null,
    letterboxdUri: String(item?.letterboxdUri || "").trim()
  }));

  const result = await runWithConcurrency(sanitized, 16);
  return res.status(200).json({ items: result });
}
