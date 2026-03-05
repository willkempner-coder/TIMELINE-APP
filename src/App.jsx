import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import Papa from "papaparse";
import INITIAL_DATA from "./initialData.json";

const STORAGE_KEY = "timeline-media-log-v6";
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || "";
const USE_SEED_DATA = String(import.meta.env.VITE_USE_SEED_DATA ?? "true").toLowerCase() !== "false";

const MEDIA_TYPES = [
  { id: "book", label: "Book", icon: "BK" },
  { id: "movie", label: "Movie", icon: "MV" },
  { id: "television", label: "TV", icon: "TV" },
  { id: "podcast", label: "Podcast", icon: "PC" },
  { id: "theater", label: "Theater", icon: "TH" },
  { id: "photo", label: "Photo", icon: "PH" },
  { id: "painting", label: "Painting", icon: "PT" },
  { id: "article", label: "Article", icon: "AR" }
];

const HISTORICAL_ERAS = [
  { id: "ancient",       label: "Ancient",        start: -3000, end: 476,  color: "#8B6914" },
  { id: "medieval",      label: "Medieval",       start: 476,   end: 1492, color: "#5B4080" },
  { id: "early-modern",  label: "Early Modern",   start: 1492,  end: 1789, color: "#3B6040" },
  { id: "revolutionary", label: "Revolutionary",  start: 1789,  end: 1848, color: "#805030" },
  { id: "victorian",     label: "Victorian",      start: 1837,  end: 1901, color: "#704060" },
  { id: "belle-epoque",  label: "Belle Époque",   start: 1871,  end: 1914, color: "#507060" },
  { id: "wwi",           label: "World War I",    start: 1914,  end: 1918, color: "#804030" },
  { id: "interwar",      label: "Interwar",       start: 1918,  end: 1939, color: "#607040" },
  { id: "wwii",          label: "World War II",   start: 1939,  end: 1945, color: "#803030" },
  { id: "cold-war",      label: "Cold War",       start: 1947,  end: 1991, color: "#304080" },
  { id: "modern",        label: "Modern Era",     start: 1991,  end: 2015, color: "#304060" },
];

// SVG path data for media type icons (viewBox 0 0 24 24, stroke-based)
const MEDIA_ICON_PATHS = {
  book:       "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z",
  movie:      "M2 8h20M2 16h20M7 2v20M17 2v20M2 2h20v20H2z",
  television: "M2 7h20v14H2zM8 2l4 5 4-5",
  podcast:    "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8",
  theater:    "M2 9c0-4 4-6 10-6s10 2 10 6-4 9-10 9S2 13 2 9zM8 12c0 1.1.9 2 2 2s2-.9 2-2M14 12c0 1.1.9 2 2 2s2-.9 2-2M9 9h.01M15 9h.01",
  photo:      "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  painting:   "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.19 0 .38-.01.57-.02A1 1 0 0 0 13 21v-2c0-.55.45-1 1-1h2c2.21 0 4-1.79 4-4 0-5.52-3.58-10-8-10z",
  article:    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
};

const MODE_SETTING = "SETTING";
const MODE_PRODUCTION = "PRODUCTION";
const MODE_BOTH = "BOTH";

const SETTING_COLORS = ["#1a3d80", "#2962b8", "#448fcc", "#6aaee0"];
const PRODUCTION_COLORS = ["#e8a800", "#d45a20", "#c02050", "#782080"];

const UNIFIED_COLORS = [
  "#e8a800", "#d45a20", "#c02050", "#782080",
  "#1a3d80", "#2962b8", "#3B7A57", "#507060",
  "#8B6914", "#306080", "#A0522D", "#5B4080"
];
const MEDIA_TYPE_COLORS = {
  book: "#3f6f52",
  movie: "#2f6ea3",
  television: "#4b5fa8",
  podcast: "#6b4aa2",
  theater: "#8a4f34",
  photo: "#2f7a78",
  painting: "#8f5c39",
  article: "#6a5f4a"
};

const SAMPLE = USE_SEED_DATA ? INITIAL_DATA : [];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_RENDERED_NODES = 500;
const MIN_NODE_PX_GAP = 22; // minimum pixel gap between distinct nodes before clustering
const VIEWPORT_BUFFER_RATIO = 0.18;
const VIEWPORT_BUFFER_MIN_YEARS = 2;
const NODE_LANE_OFFSET = 16;
const FUTURE_HEADROOM_YEARS = 300;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function laneNodeOffset(_lane) {
  return 0; // nodes sit directly on the timeline line
}

function toYear(value) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  // Support "1940s", "1940S" → 1940
  const decadeMatch = s.match(/^(\d{3,4})s$/i);
  if (decadeMatch) return parseInt(decadeMatch[1], 10);
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function nowYearFraction() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1).getTime();
  return now.getFullYear() + (now.getTime() - yearStart) / (yearEnd - yearStart);
}

function defaultState(presentYear) {
  return {
    span: 140,
    end: presentYear
  };
}

function toX(year, start, span, width) {
  return ((year - start) / span) * width;
}

function getTickStep(spanYears, showMonths = false) {
  if (spanYears <= 3) return showMonths ? 1 / 12 : 1;
  if (spanYears <= 15) return 1;
  if (spanYears <= 80) return 5;
  if (spanYears <= 220) return 10;
  if (spanYears <= 800) return 50;
  if (spanYears <= 2200) return 100;
  return 500;
}

function formatTick(yearValue, step) {
  if (step < 1) {
    const year = Math.floor(yearValue);
    const monthIdx = Math.min(11, Math.max(0, Math.round((yearValue - year) * 12)));
    return `${MONTHS[monthIdx]} ${year}`;
  }
  if (yearValue < 0) return `${Math.abs(Math.round(yearValue))} BCE`;
  return String(Math.round(yearValue));
}

function getType(typeId) {
  return MEDIA_TYPES.find((item) => item.id === typeId) ?? MEDIA_TYPES[0];
}

function colorFor(entryId) {
  let hash = 0;
  for (let i = 0; i < entryId.length; i += 1) {
    hash = (hash * 33 + entryId.charCodeAt(i)) % 100000;
  }
  return UNIFIED_COLORS[hash % UNIFIED_COLORS.length];
}

function colorForMediaType(typeId) {
  return MEDIA_TYPE_COLORS[typeId] || "#1c1a17";
}

function spreadX(centerX, index, total, spacing) {
  return centerX + (index - (total - 1) / 2) * spacing;
}

function intersects(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

function toEntryId(prefix = "m") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseRows(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true
  });
  return Array.isArray(parsed.data) ? parsed.data : [];
}

function inferSettingRangeHeuristic(title, productionYear) {
  const t = String(title || "").toLowerCase();

  const exact = t.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/g);
  if (exact && exact.length > 0) {
    const years = exact.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (years.length > 0) {
      return { settingStart: Math.min(...years), settingEnd: Math.max(...years) };
    }
  }

  const decade = t.match(/\b(\d{3,4})s\b/);
  if (decade) {
    const start = Number(decade[1]);
    return { settingStart: start, settingEnd: start + 9 };
  }

  const century = t.match(/\b(\d{1,2})(st|nd|rd|th)\s+century\b/);
  if (century) {
    const c = Number(century[1]);
    if (Number.isFinite(c) && c > 0) {
      return { settingStart: (c - 1) * 100, settingEnd: c * 100 - 1 };
    }
  }

  if (t.includes("world war ii") || t.includes("wwii")) return { settingStart: 1939, settingEnd: 1945 };
  if (t.includes("world war i") || t.includes("wwi")) return { settingStart: 1914, settingEnd: 1918 };
  if (t.includes("civil war")) return { settingStart: 1861, settingEnd: 1865 };
  if (t.includes("cold war")) return { settingStart: 1947, settingEnd: 1991 };
  if (t.includes("medieval")) return { settingStart: 500, settingEnd: 1500 };

  if (productionYear && Number.isFinite(productionYear) && productionYear < 1950) {
    return { settingStart: productionYear, settingEnd: productionYear };
  }

  return { settingStart: null, settingEnd: null };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;

  const mediaType = raw.mediaType || raw.type || "book";
  const productionStart = toYear(raw.productionStart ?? raw.publishedYear);
  const productionEnd = toYear(raw.productionEnd ?? raw.publishedYear ?? raw.productionStart);
  const settingStart = toYear(raw.settingStart ?? raw.subjectStartYear);
  const settingEnd = toYear(raw.settingEnd ?? raw.subjectEndYear ?? raw.settingStart ?? raw.subjectStartYear);

  if (!raw.title) return null;

  const hasSetting = Number.isFinite(settingStart) || Number.isFinite(settingEnd);
  const userLocked = raw.settingUserLocked ?? (!raw.settingAuto && hasSetting);

  return {
    id: raw.id || `seed-${Math.random().toString(36).slice(2, 8)}`,
    mediaType,
    title: String(raw.title),
    creator: String(raw.creator || raw.author || ""),
    productionStart,
    productionEnd,
    settingStart,
    settingEnd,
    source: raw.source || "manual",
    settingSource: raw.settingSource || (userLocked && hasSetting ? "manual" : hasSetting ? "heuristic" : null),
    settingConfidence: Number.isFinite(raw.settingConfidence) ? raw.settingConfidence : null,
    settingAuto: Boolean(raw.settingAuto) && !userLocked,
    settingUserLocked: Boolean(userLocked),
    inferenceStatus: raw.inferenceStatus || (userLocked || hasSetting ? "done" : "idle"),
    notes: typeof raw.notes === "string" ? raw.notes : "",
    tags: Array.isArray(raw.tags) ? raw.tags : []
  };
}

function parseSearch(query) {
  const cleaned = query.trim();
  const upper = cleaned.toUpperCase();

  let laneHint = null;
  if (upper.includes("SETTING") || upper.includes("ABOUT")) laneHint = MODE_SETTING;
  if (upper.includes("PRODUCTION") || upper.includes("OF THE ERA") || upper.includes("MADE")) laneHint = MODE_PRODUCTION;

  const decadeMatch = upper.match(/\b(\d{3,4})S\b/);
  const exactYearMatch = upper.match(/\b(\d{4})\b/);

  let yearRange = null;
  if (decadeMatch) {
    const start = Number(decadeMatch[1]);
    yearRange = [start, start + 99];
  } else if (exactYearMatch) {
    const y = Number(exactYearMatch[1]);
    yearRange = [y, y];
  }

  const text = cleaned
    .replace(/\b(SETTING|PRODUCTION|ABOUT|MADE|OF THE ERA)\b/gi, "")
    .replace(/\b\d{3,4}S\b/gi, "")
    .replace(/\b\d{4}\b/g, "")
    .trim()
    .toLowerCase();

  return { laneHint, yearRange, text };
}

function fromGoodreadsCsv(csvText) {
  const rows = parseRows(csvText);

  return rows
    .map((row) => {
      const title = (row.Title || "").trim();
      if (!title) return null;

      const creator = (row.Author || "").trim();
      const prod = toYear(row["Original Publication Year"] || row["Year Published"]);
      const heuristic = inferSettingRangeHeuristic(title, prod);
      const hasHeuristicSetting = Number.isFinite(heuristic.settingStart) || Number.isFinite(heuristic.settingEnd);

      return {
        id: toEntryId("gr"),
        mediaType: "book",
        title,
        creator,
        productionStart: prod,
        productionEnd: prod,
        settingStart: heuristic.settingStart,
        settingEnd: heuristic.settingEnd,
        source: "goodreads",
        settingSource: hasHeuristicSetting ? "heuristic" : null,
        settingConfidence: hasHeuristicSetting ? 0.18 : null,
        settingAuto: hasHeuristicSetting,
        settingUserLocked: false,
        inferenceStatus: "idle"
      };
    })
    .filter(Boolean);
}

async function fromLetterboxdZip(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const diary = zip.file("diary.csv");
  const watched = zip.file("watched.csv");
  const sourceFile = diary || watched;
  if (!sourceFile) return [];

  const csvText = await sourceFile.async("string");
  const rows = parseRows(csvText);

  return rows
    .map((row) => {
      const title = (row.Name || "").trim();
      if (!title) return null;

      const prodYear = toYear(row.Year);
      const heuristic = inferSettingRangeHeuristic(title, prodYear);
      const hasHeuristicSetting = Number.isFinite(heuristic.settingStart) || Number.isFinite(heuristic.settingEnd);
      const mediaType = /season|episode/i.test(title) ? "television" : "movie";

      return {
        id: toEntryId("lb"),
        mediaType,
        title,
        creator: "",
        productionStart: prodYear,
        productionEnd: prodYear,
        settingStart: heuristic.settingStart,
        settingEnd: heuristic.settingEnd,
        source: "letterboxd",
        settingSource: hasHeuristicSetting ? "heuristic" : null,
        settingConfidence: hasHeuristicSetting ? 0.18 : null,
        settingAuto: hasHeuristicSetting,
        settingUserLocked: false,
        inferenceStatus: "idle"
      };
    })
    .filter(Boolean);
}

function getBucketLevelsForSpan(span) {
  const levels = [1 / 12, 1, 10, 100, 1000, 5000];
  let baseIndex = 0;

  if (span <= 2) baseIndex = 0;
  else if (span <= 120) baseIndex = 1;
  else if (span <= 1200) baseIndex = 2;
  else baseIndex = 3;

  return levels.slice(baseIndex);
}

function sampleItemsEvenly(items, maxItems) {
  if (items.length <= maxItems) return items;
  if (maxItems <= 0) return [];

  const out = [];
  const step = items.length / maxItems;
  for (let i = 0; i < maxItems; i += 1) {
    out.push(items[Math.floor(i * step)]);
  }
  return out;
}

function buildClusters(markers, bucketSize, start, span, width) {
  if (markers.length === 0) return [];

  const grouped = new Map();

  for (const marker of markers) {
    const bucket = Math.floor(marker.primaryYear / bucketSize);
    const key = `${marker.lane}-${bucket}`;
    const prev = grouped.get(key);

    if (!prev) {
      grouped.set(key, {
        id: key,
        lane: marker.lane,
        markers: [marker]
      });
    } else {
      prev.markers.push(marker);
    }
  }

  const collapsed = [];

  for (const group of grouped.values()) {
    group.markers.sort((a, b) => a.primaryYear - b.primaryYear);

    if (group.markers.length === 1) {
      collapsed.push({
        type: "node",
        lane: group.lane,
        marker: group.markers[0],
        x: group.markers[0].xStart
      });
      continue;
    }

    const avgYear = group.markers.reduce((sum, marker) => sum + marker.primaryYear, 0) / group.markers.length;
    collapsed.push({
      type: "cluster",
      id: group.id,
      lane: group.lane,
      year: avgYear,
      markers: group.markers,
      x: toX(avgYear, start, span, width),
      size: group.markers.length
    });
  }

  return collapsed.sort((a, b) => a.x - b.x);
}

function allocateLaneCaps(productionCount, settingCount, maxTotal) {
  if (maxTotal <= 0) {
    return {
      [MODE_PRODUCTION]: 0,
      [MODE_SETTING]: 0
    };
  }

  if (productionCount <= 0 && settingCount <= 0) {
    return {
      [MODE_PRODUCTION]: 0,
      [MODE_SETTING]: 0
    };
  }

  if (settingCount <= 0) {
    return {
      [MODE_PRODUCTION]: maxTotal,
      [MODE_SETTING]: 0
    };
  }

  if (productionCount <= 0) {
    return {
      [MODE_PRODUCTION]: 0,
      [MODE_SETTING]: maxTotal
    };
  }

  const total = productionCount + settingCount;
  let productionCap = Math.max(1, Math.floor((productionCount / total) * maxTotal));
  let settingCap = Math.max(1, maxTotal - productionCap);

  while (productionCap + settingCap > maxTotal) {
    if (productionCap >= settingCap && productionCap > 1) productionCap -= 1;
    else if (settingCap > 1) settingCap -= 1;
    else break;
  }

  while (productionCap + settingCap < maxTotal) {
    const productionDeficit = Math.max(0, productionCount - productionCap);
    const settingDeficit = Math.max(0, settingCount - settingCap);
    if (productionDeficit >= settingDeficit) productionCap += 1;
    else settingCap += 1;
  }

  return {
    [MODE_PRODUCTION]: productionCap,
    [MODE_SETTING]: settingCap
  };
}

function buildLaneRenderItems(markers, laneCap, start, span, width) {
  if (markers.length === 0) return [];

  const sorted = [...markers].sort((a, b) => a.primaryYear - b.primaryYear);
  const resolution = resolutionFromSpan(span);

  // Pixel-space density clustering: merge nodes that would render within MIN_NODE_PX_GAP px
  const yearsPerPixel = span / Math.max(1, width);
  const minYearGap = MIN_NODE_PX_GAP * yearsPerPixel;

  const groups = [];
  let currentGroup = [sorted[0]];
  let groupBaseYear = sorted[0].primaryYear;

  for (let i = 1; i < sorted.length; i++) {
    const marker = sorted[i];
    if (marker.primaryYear - groupBaseYear < minYearGap) {
      currentGroup.push(marker);
    } else {
      groups.push(currentGroup);
      currentGroup = [marker];
      groupBaseYear = marker.primaryYear;
    }
  }
  groups.push(currentGroup);

  const rendered = groups.map((group, groupIndex) => {
    if (group.length === 1) {
      return {
        type: "node",
        lane: group[0].lane,
        marker: group[0],
        x: group[0].xStart,
        resolution
      };
    }
    const avgYear = group.reduce((sum, m) => sum + m.primaryYear, 0) / group.length;
    const bucketKey = Math.round(avgYear / Math.max(1, minYearGap));
    const firstMarkerId = group[0]?.id ?? `g${groupIndex}`;
    const lastMarkerId = group[group.length - 1]?.id ?? `g${groupIndex}`;
    const id = `${group[0].lane}-cluster-${bucketKey}-${firstMarkerId}-${lastMarkerId}`;
    return {
      type: "cluster",
      id,
      lane: group[0].lane,
      year: avgYear,
      markers: group,
      x: toX(avgYear, start, span, width),
      size: group.length,
      resolution
    };
  });

  if (rendered.length > laneCap) {
    return sampleItemsEvenly(rendered, laneCap).sort((a, b) => a.x - b.x);
  }

  return rendered.sort((a, b) => a.x - b.x);
}

function renderItemWeight(item, span) {
  if (item.type === "cluster") return 1;
  if (!item.marker) return 1;
  const hasRangeEndCap = span <= 220 && item.marker.rangeEnd > item.marker.rangeStart;
  return hasRangeEndCap ? 2 : 1;
}

function countRenderUnits(items, span) {
  let total = 0;
  for (const item of items) {
    total += renderItemWeight(item, span);
  }
  return total;
}

function capRenderItemsByUnits(items, span, maxUnits) {
  if (maxUnits <= 0 || items.length === 0) return [];

  const output = [];
  let used = 0;

  for (const item of items) {
    const units = renderItemWeight(item, span);
    if (used + units > maxUnits) continue;
    output.push(item);
    used += units;
    if (used >= maxUnits) break;
  }

  return output;
}

function resolutionFromBucket(bucketSize) {
  if (!Number.isFinite(bucketSize)) return "year";
  if (bucketSize >= 100) return "century";
  if (bucketSize >= 10) return "decade";
  return "year";
}

function nextZoomSpanForResolution(resolution) {
  if (resolution === "century") return 60;   // centuries → zoom to 60-year window
  if (resolution === "decade") return 16;    // decades → zoom to 16-year window
  if (resolution === "year") return 4;       // years → zoom to 4-year window
  return null;
}

function resolutionFromSpan(span) {
  if (span > 200) return "century";
  if (span > 40) return "decade";
  if (span > 8) return "year";
  return "detail";
}

function formatClusterLabel(item) {
  if (!item || !Number.isFinite(item.year)) return `${item?.size ?? ""} media`.trim();
  if (item.resolution === "century") {
    const cStart = Math.floor(item.year / 100) * 100;
    return `${cStart}s media`;
  }
  if (item.resolution === "decade") {
    const dStart = Math.floor(item.year / 10) * 10;
    const years = Array.isArray(item.markers)
      ? item.markers.map((marker) => marker.primaryYear).filter(Number.isFinite)
      : [];
    if (years.length > 0) {
      const minY = Math.min(...years);
      const maxY = Math.max(...years);
      const minDecade = Math.floor(minY / 10) * 10;
      const maxDecade = Math.floor(maxY / 10) * 10;

      if (minDecade === dStart && maxDecade === dStart) {
        const partOfDecade = (year) => {
          const ones = ((Math.round(year) % 10) + 10) % 10;
          if (ones <= 2) return "Early";
          if (ones >= 7) return "Late";
          return "Mid";
        };

        const minPart = partOfDecade(minY);
        const maxPart = partOfDecade(maxY);
        if (minPart === maxPart && minPart !== "Mid") {
          return `${minPart} ${dStart}s media`;
        }
      }
    }
    return `${dStart}s media`;
  }
  return `${Math.round(item.year)} media`;
}

function getEntryLaneYear(entry, lane) {
  if (!entry) return null;
  if (lane === MODE_PRODUCTION) return entry.productionStart ?? entry.productionEnd;
  if (lane === MODE_SETTING) return entry.settingStart ?? entry.settingEnd;
  return null;
}

function parseTextYears(text) {
  if (!text) return null;
  const src = String(text);

  const rangeMatch = src.match(/\b(1[0-9]{3}|20[0-2][0-9])\s*(?:-|–|to)\s*(1[0-9]{3}|20[0-2][0-9])\b/i);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    const contextual = /(set in|takes place|during|period|depict|story|chronolog|fictional)/i.test(src);
    return {
      settingStart: Math.min(start, end),
      settingEnd: Math.max(start, end),
      confidence: contextual ? 0.74 : 0.62
    };
  }

  const decadeMatch = src.match(/\b(\d{3,4})s\b/i);
  if (decadeMatch) {
    const start = Number(decadeMatch[1]);
    const contextual = /(set in|takes place|during|period|depict|story|chronolog|fictional)/i.test(src);
    return {
      settingStart: start,
      settingEnd: start + 9,
      confidence: contextual ? 0.66 : 0.53
    };
  }

  const yearMatches = src.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/g);
  if (yearMatches && yearMatches.length > 0) {
    const values = yearMatches.map((v) => Number(v)).filter(Number.isFinite);
    if (values.length > 0) {
      const contextual = /(set in|takes place|during|period|depict|story|chronolog|fictional)/i.test(src);
      return {
        settingStart: Math.min(...values),
        settingEnd: Math.max(...values),
        confidence: contextual ? 0.58 : 0.38
      };
    }
  }

  const centuryMatch = src.match(/\b(\d{1,2})(st|nd|rd|th)\s+century\b/i);
  if (centuryMatch) {
    const c = Number(centuryMatch[1]);
    if (Number.isFinite(c) && c > 0) {
      return {
        settingStart: (c - 1) * 100,
        settingEnd: c * 100 - 1,
        confidence: 0.55
      };
    }
  }

  return null;
}

function parseWikidataTime(value) {
  const raw = value?.time;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^([+-])(\d{1,6})-/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(match[2]);
}

function normalizeCandidate(candidate, presentYear, source) {
  if (!candidate) return null;

  const startRaw = toYear(candidate.settingStart);
  const endRaw = toYear(candidate.settingEnd ?? candidate.settingStart);

  if (!Number.isFinite(startRaw) && !Number.isFinite(endRaw)) return null;

  const start = Number.isFinite(startRaw) ? startRaw : endRaw;
  const end = Number.isFinite(endRaw) ? endRaw : startRaw;

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return {
    settingStart: Math.min(start, end, Math.floor(presentYear)),
    settingEnd: Math.min(Math.max(start, end), Math.floor(presentYear)),
    confidence: clamp(Number(candidate.confidence || 0.4), 0, 1),
    source
  };
}

async function fetchJson(url, timeout = 7000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function findWikidataClaimTimes(claims) {
  if (!claims) return null;

  const pickTime = (property) => {
    const statements = claims[property];
    if (!Array.isArray(statements)) return null;

    for (const statement of statements) {
      const value = statement?.mainsnak?.datavalue?.value;
      if (!value) continue;
      const year = parseWikidataTime(value);
      if (Number.isFinite(year)) return year;
    }

    return null;
  };

  const start = pickTime("P580");
  const end = pickTime("P582");
  const point = pickTime("P585");
  const publication = pickTime("P577");

  if (Number.isFinite(start) || Number.isFinite(end)) {
    return {
      settingStart: Number.isFinite(start) ? start : end,
      settingEnd: Number.isFinite(end) ? end : start,
      confidence: 0.9
    };
  }

  if (Number.isFinite(point)) {
    return {
      settingStart: point,
      settingEnd: point,
      confidence: 0.72
    };
  }

  if (Number.isFinite(publication)) {
    return {
      settingStart: publication,
      settingEnd: publication,
      confidence: 0.28
    };
  }

  return null;
}

function collectWikidataLinkedIds(claims, property) {
  const statements = claims?.[property];
  if (!Array.isArray(statements)) return [];

  const ids = [];
  for (const statement of statements) {
    const value = statement?.mainsnak?.datavalue?.value;
    const id = value?.id;
    if (typeof id === "string" && id.startsWith("Q")) ids.push(id);
  }
  return ids;
}

async function inferFromWikidata(entry, presentYear) {
  const searchParams = new URLSearchParams({
    action: "wbsearchentities",
    search: entry.title,
    language: "en",
    format: "json",
    origin: "*",
    limit: "5"
  });

  const search = await fetchJson(`https://www.wikidata.org/w/api.php?${searchParams.toString()}`);
  const candidates = Array.isArray(search?.search) ? search.search : [];
  if (candidates.length === 0) return null;

  const exact = candidates.find((item) => String(item.label || "").toLowerCase() === entry.title.toLowerCase());
  const selected = exact || candidates[0];
  if (!selected?.id) return null;

  const entityParams = new URLSearchParams({
    action: "wbgetentities",
    ids: selected.id,
    props: "claims|labels",
    languages: "en",
    format: "json",
    origin: "*"
  });

  const entityRes = await fetchJson(`https://www.wikidata.org/w/api.php?${entityParams.toString()}`);
  const entity = entityRes?.entities?.[selected.id];
  if (!entity?.claims) return null;

  const direct = normalizeCandidate(findWikidataClaimTimes(entity.claims), presentYear, "wikidata");

  const linkedIds = [
    ...collectWikidataLinkedIds(entity.claims, "P2408"),
    ...collectWikidataLinkedIds(entity.claims, "P2348")
  ].slice(0, 8);

  if (linkedIds.length > 0) {
    const linkedParams = new URLSearchParams({
      action: "wbgetentities",
      ids: Array.from(new Set(linkedIds)).join("|"),
      props: "claims|labels",
      languages: "en",
      format: "json",
      origin: "*"
    });

    const linkedRes = await fetchJson(`https://www.wikidata.org/w/api.php?${linkedParams.toString()}`);
    const linkedEntities = Object.values(linkedRes?.entities || {});

    for (const linked of linkedEntities) {
      const candidate = normalizeCandidate(findWikidataClaimTimes(linked?.claims), presentYear, "wikidata");
      if (candidate) {
        candidate.confidence = clamp(candidate.confidence + 0.05, 0, 1);
        return candidate;
      }

      const label = linked?.labels?.en?.value;
      const fromLabel = normalizeCandidate(parseTextYears(label), presentYear, "wikidata");
      if (fromLabel) return fromLabel;
    }
  }

  return direct;
}

async function inferFromWikipedia(entry, presentYear) {
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entry.title)}`;
  let summary = await fetchJson(summaryUrl);

  if (!summary?.extract) {
    const searchParams = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: entry.title,
      format: "json",
      origin: "*",
      srlimit: "1"
    });
    const result = await fetchJson(`https://en.wikipedia.org/w/api.php?${searchParams.toString()}`);
    const topTitle = result?.query?.search?.[0]?.title;
    if (topTitle) {
      summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`);
    }
  }

  const textCandidate = parseTextYears(`${summary?.description || ""} ${summary?.extract || ""}`);
  return normalizeCandidate(textCandidate, presentYear, "wikipedia");
}

async function inferFromOpenLibrary(entry, presentYear) {
  const params = new URLSearchParams({
    title: entry.title,
    limit: "5"
  });
  if (entry.creator) params.set("author", entry.creator);

  const search = await fetchJson(`https://openlibrary.org/search.json?${params.toString()}`);
  const docs = Array.isArray(search?.docs) ? search.docs : [];
  if (docs.length === 0) return null;

  const doc = docs[0];

  const subjectTexts = [];
  if (Array.isArray(doc.subject_time)) subjectTexts.push(...doc.subject_time);
  if (Array.isArray(doc.time)) subjectTexts.push(...doc.time);

  for (const item of subjectTexts) {
    const candidate = normalizeCandidate(parseTextYears(item), presentYear, "openlibrary");
    if (candidate) {
      candidate.confidence = clamp(candidate.confidence + 0.08, 0, 1);
      return candidate;
    }
  }

  if (typeof doc.key === "string") {
    const work = await fetchJson(`https://openlibrary.org${doc.key}.json`);

    if (Array.isArray(work?.subject_times)) {
      for (const item of work.subject_times) {
        const candidate = normalizeCandidate(parseTextYears(item), presentYear, "openlibrary");
        if (candidate) {
          candidate.confidence = clamp(candidate.confidence + 0.08, 0, 1);
          return candidate;
        }
      }
    }

    const desc = typeof work?.description === "string" ? work.description : work?.description?.value;
    const fromDesc = normalizeCandidate(parseTextYears(desc), presentYear, "openlibrary");
    if (fromDesc) return fromDesc;
  }

  return null;
}

async function inferFromTmdb(entry, presentYear) {
  if (!TMDB_API_KEY) return null;

  const mediaPath = entry.mediaType === "television" ? "tv" : "movie";
  const query = new URLSearchParams({
    api_key: TMDB_API_KEY,
    query: entry.title,
    language: "en-US",
    include_adult: "false"
  });

  const search = await fetchJson(`https://api.themoviedb.org/3/search/${mediaPath}?${query.toString()}`);
  const result = search?.results?.[0];
  if (!result?.id) return null;

  const detail = await fetchJson(
    `https://api.themoviedb.org/3/${mediaPath}/${result.id}?${new URLSearchParams({
      api_key: TMDB_API_KEY,
      language: "en-US"
    }).toString()}`
  );

  const fromOverview = normalizeCandidate(parseTextYears(detail?.overview), presentYear, "tmdb");
  if (fromOverview) {
    fromOverview.confidence = clamp(fromOverview.confidence, 0, 0.6);
    return fromOverview;
  }

  return null;
}

async function inferSettingFromSources(entry, presentYear) {
  const wikidata = await inferFromWikidata(entry, presentYear);
  if (wikidata) return wikidata;

  const wikipedia = await inferFromWikipedia(entry, presentYear);
  if (wikipedia) return wikipedia;

  if (entry.mediaType === "book") {
    const openLibrary = await inferFromOpenLibrary(entry, presentYear);
    if (openLibrary) return openLibrary;
  }

  if (entry.mediaType === "movie" || entry.mediaType === "television") {
    const tmdb = await inferFromTmdb(entry, presentYear);
    if (tmdb) return tmdb;
  }

  return null;
}

function shouldInferSetting(entry) {
  if (!entry) return false;
  if (entry.settingUserLocked) return false;
  if (entry.inferenceStatus === "running" || entry.inferenceStatus === "pending") return false;

  const hasReliableAuto = Number.isFinite(entry.settingStart) && entry.settingAuto && entry.settingSource && entry.settingSource !== "heuristic";
  if (hasReliableAuto) return false;

  const hasProduction = Number.isFinite(entry.productionStart) || Number.isFinite(entry.productionEnd);
  return hasProduction || Boolean(entry.title);
}

function App() {
  const presentYear = useMemo(() => nowYearFraction(), []);
  const [timelineState, setTimelineState] = useState(() => defaultState(presentYear));

  const [mode, setMode] = useState(MODE_SETTING);
  const [viewMode, setViewMode] = useState("timeline"); // "timeline" | "scatter"
  const [query, setQuery] = useState("");
  const [hoveredEntryId, setHoveredEntryId] = useState(null);
  const [hoveredClusterId, setHoveredClusterId] = useState(null);
  const [hoveredRangeMarkerId, setHoveredRangeMarkerId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [tocFilter, setTocFilter] = useState(MODE_PRODUCTION);
  const [titleSuggestions, setTitleSuggestions] = useState([]);
  const [titleSearchLoading, setTitleSearchLoading] = useState(false);
  const titleSearchTimerRef = useRef(null);

  const [showMonthResolution, setShowMonthResolution] = useState(false);
  const [showEras, setShowEras] = useState(true);
  const [addShowProdEnd, setAddShowProdEnd] = useState(false);
  const [addShowSetEnd, setAddShowSetEnd] = useState(false);

  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [popupAnchor, setPopupAnchor] = useState(null);
  const [popupOrigin, setPopupOrigin] = useState({ x: 0, y: 0 });
  const [popupClosing, setPopupClosing] = useState(false);
  const [expandedClusterId, setExpandedClusterId] = useState(null);
  const [expandedBranchType, setExpandedBranchType] = useState(null);
  const [gridClusterId, setGridClusterId] = useState(null);
  const [burstMap, setBurstMap] = useState({});
  const [flight, setFlight] = useState(null);
  const [importState, setImportState] = useState({ phase: "idle", message: "" });

  const [inferenceUi, setInferenceUi] = useState({
    queued: 0,
    running: 0,
    resolved: 0,
    failed: 0
  });

  const [source, setSource] = useState("goodreads");
  const [importFile, setImportFile] = useState(null);

  const [addDraft, setAddDraft] = useState({
    mediaType: "book",
    title: "",
    creator: "",
    productionStart: "",
    productionEnd: "",
    settingStart: "",
    settingEnd: "",
    notes: "",
    tags: ""
  });

  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState(null);

  const [soloType, setSoloType] = useState(null); // null = show all, string = solo that type
  const [tocTypeFilter, setTocTypeFilter] = useState(null); // null = show all types in TOC
  const [preZoomState, setPreZoomState] = useState(null); // saved zoom state before node click
  const preZoomStateRef = useRef(null);

  const [darkMode, setDarkMode] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [inlineNotesOpen, setInlineNotesOpen] = useState(false);
  const [inlineNotesDraft, setInlineNotesDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const [entries, setEntries] = useState(() => {
    // Clean up stale keys from old versions
    ["v1","v2","v3","v4","v5"].forEach(v =>
      localStorage.removeItem(`timeline-media-log-${v}`)
    );
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return SAMPLE;

    try {
      const parsed = JSON.parse(saved);
      const normalized = Array.isArray(parsed) ? parsed.map(normalizeEntry).filter(Boolean) : [];
      return normalized.length > 0 ? normalized : SAMPLE;
    } catch {
      return SAMPLE;
    }
  });

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    selectedEntryIdRef.current = selectedEntryId;
  }, [selectedEntryId]);

  useEffect(() => {
    popupClosingRef.current = popupClosing;
  }, [popupClosing]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    pendingZoomSpanRef.current = timelineState.span;
  }, [timelineState.span]);

  useEffect(() => {
    const vs = clamp(timelineState.end, -100000, presentYear) - timelineState.span;
    pendingViewStartRef.current = vs;
  }, [timelineState.end, timelineState.span, presentYear]);

  const canvasRef = useRef(null);
  const popupRef = useRef(null);
  const addButtonRef = useRef(null);
  const zoomDragRef = useRef(null);

  const overviewRef = useRef(null);
  const overviewRectDragRef = useRef(null);
  const overviewEdgeDragRef = useRef(null);
  const overviewResizeRef = useRef(null);
  const scheduledWindowRef = useRef(null);
  const scheduledWindowRafRef = useRef(null);

  const inferenceQueueRef = useRef([]);
  const inferenceQueuedSetRef = useRef(new Set());
  const inferenceInFlightSetRef = useRef(new Set());
  const inferenceRunningRef = useRef(false);

  const [canvasRect, setCanvasRect] = useState({ width: 1200, height: 720 });
  const [overviewWidth, setOverviewWidth] = useState(360);
  const [overviewHeight, setOverviewHeight] = useState(58);
  const popupCloseTimerRef = useRef(null);
  const centerMoveRafRef = useRef(null);
  const pendingZoomSpanRef = useRef(timelineState.span);
  const pendingViewStartRef = useRef(timelineState.end - timelineState.span);
  const selectedEntryIdRef = useRef(null);
  const popupClosingRef = useRef(false);
  const [popupSize, setPopupSize] = useState({ width: 420, height: 320 });

  useEffect(() => {
    preZoomStateRef.current = preZoomState;
  }, [preZoomState]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;

    const observer = new ResizeObserver((items) => {
      const item = items[0];
      if (!item) return;

      setCanvasRect({
        width: Math.max(400, item.contentRect.width),
        height: Math.max(420, item.contentRect.height)
      });
    });

    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!overviewRef.current) return undefined;

    const observer = new ResizeObserver((items) => {
      const item = items[0];
      if (!item) return;
      setOverviewWidth(Math.max(180, item.contentRect.width));
    });

    observer.observe(overviewRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // Prevent browser/page pinch-zoom so trackpad pinch controls timeline zoom.
    const preventGestureZoom = (event) => event.preventDefault();
    const preventBrowserPinchWheel = (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };

    canvas.addEventListener("gesturestart", preventGestureZoom, { passive: false });
    canvas.addEventListener("gesturechange", preventGestureZoom, { passive: false });
    canvas.addEventListener("gestureend", preventGestureZoom, { passive: false });
    canvas.addEventListener("wheel", preventBrowserPinchWheel, { passive: false });

    return () => {
      canvas.removeEventListener("gesturestart", preventGestureZoom);
      canvas.removeEventListener("gesturechange", preventGestureZoom);
      canvas.removeEventListener("gestureend", preventGestureZoom);
      canvas.removeEventListener("wheel", preventBrowserPinchWheel);
    };
  }, []);

  useLayoutEffect(() => {
    if (!popupRef.current) return undefined;

    const updateSize = () => {
      if (!popupRef.current) return;
      const rect = popupRef.current.getBoundingClientRect();
      setPopupSize({
        width: rect.width,
        height: rect.height
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(popupRef.current);
    return () => observer.disconnect();
  }, [selectedEntryId, editMode]);

  useEffect(() => {
    return () => {
      if (scheduledWindowRafRef.current) {
        window.cancelAnimationFrame(scheduledWindowRafRef.current);
      }
      if (centerMoveRafRef.current) {
        window.cancelAnimationFrame(centerMoveRafRef.current);
      }
      if (popupCloseTimerRef.current) {
        window.clearTimeout(popupCloseTimerRef.current);
      }
      if (titleSearchTimerRef.current) {
        window.clearTimeout(titleSearchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedEntryId) {
      setEditDraft(null);
      setEditMode(false);
      setPopupAnchor(null);
      return;
    }

    const found = entries.find((item) => item.id === selectedEntryId);
    if (!found) {
      setSelectedEntryId(null);
      setEditDraft(null);
      setEditMode(false);
      return;
    }

    setEditDraft({
      mediaType: found.mediaType,
      title: found.title,
      creator: found.creator,
      productionStart: found.productionStart ?? "",
      productionEnd: found.productionEnd ?? "",
      settingStart: found.settingStart ?? "",
      settingEnd: found.settingEnd ?? ""
    });
  }, [entries, selectedEntryId]);

  const selectedEntry = useMemo(() => entries.find((entry) => entry.id === selectedEntryId) || null, [entries, selectedEntryId]);
  const tocEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const ay = a.productionStart ?? a.settingStart ?? -999999;
      const by = b.productionStart ?? b.settingStart ?? -999999;
      return by - ay;
    });
  }, [entries]);

  const viewEnd = clamp(timelineState.end, -100000, 100000);
  const viewStart = viewEnd - timelineState.span;

  const allKnownYears = useMemo(() => {
    const years = [Math.floor(presentYear)];

    for (const entry of entries) {
      for (const value of [entry.productionStart, entry.productionEnd, entry.settingStart, entry.settingEnd]) {
        if (Number.isFinite(value)) years.push(value);
      }
    }

    years.push(viewStart);
    return years;
  }, [entries, presentYear, viewStart]);

  const overviewRange = useMemo(() => {
    const minYear = Math.min(...allKnownYears);
    const start = Math.floor(Math.min(minYear, presentYear - 500) / 10) * 10 - 20;
    const end = Math.ceil((presentYear + FUTURE_HEADROOM_YEARS) / 10) * 10;
    return {
      start,
      end,
      span: Math.max(1, end - start)
    };
  }, [allKnownYears, presentYear]);

  const overviewHandle = useMemo(() => {
    const left = ((viewStart - overviewRange.start) / overviewRange.span) * overviewWidth;
    const width = Math.max(24, (timelineState.span / overviewRange.span) * overviewWidth);

    return {
      left: clamp(left, 0, Math.max(0, overviewWidth - width)),
      width: Math.min(width, overviewWidth)
    };
  }, [overviewRange.span, overviewRange.start, overviewWidth, timelineState.span, viewStart]);

  const parsedSearch = useMemo(() => parseSearch(query), [query]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (soloType !== null && entry.mediaType !== soloType) return false;

      if (parsedSearch.text) {
        const haystack = `${entry.title} ${entry.creator} ${entry.mediaType}`.toLowerCase();
        if (!haystack.includes(parsedSearch.text) &&
            !(entry.notes && entry.notes.toLowerCase().includes(parsedSearch.text)) &&
            !(Array.isArray(entry.tags) && entry.tags.some(t => t.toLowerCase().includes(parsedSearch.text)))) {
          return false;
        }
      }

      if (!parsedSearch.yearRange) return true;
      const [start, end] = parsedSearch.yearRange;

      const prodStart = entry.productionStart ?? entry.productionEnd;
      const prodEnd = entry.productionEnd ?? entry.productionStart;
      const setStart = entry.settingStart ?? entry.settingEnd;
      const setEnd = entry.settingEnd ?? entry.settingStart;

      const productionHit =
        Number.isFinite(prodStart) && Number.isFinite(prodEnd) && intersects(Math.min(prodStart, prodEnd), Math.max(prodStart, prodEnd), start, end);
      const settingHit =
        Number.isFinite(setStart) && Number.isFinite(setEnd) && intersects(Math.min(setStart, setEnd), Math.max(setStart, setEnd), start, end);

      const laneHint = parsedSearch.laneHint || (mode === MODE_BOTH ? null : mode);

      if (laneHint === MODE_SETTING) return settingHit;
      if (laneHint === MODE_PRODUCTION) return productionHit;
      return settingHit || productionHit;
    });
  }, [soloType, entries, mode, parsedSearch]);

  const overviewMiniPoints = useMemo(() => {
    const byBucket = new Map();
    const lanesToShow = mode === MODE_BOTH ? [MODE_PRODUCTION, MODE_SETTING] : [mode];

    for (const entry of filteredEntries) {
      for (const lane of lanesToShow) {
        const startYear = lane === MODE_PRODUCTION ? entry.productionStart : entry.settingStart;
        const endYear = lane === MODE_PRODUCTION ? entry.productionEnd : entry.settingEnd;
        const year = Number.isFinite(startYear) ? startYear : endYear;
        if (!Number.isFinite(year)) continue;
        if (year < overviewRange.start || year > overviewRange.end) continue;

        const x = ((year - overviewRange.start) / overviewRange.span) * overviewWidth;
        const bucket = `${lane}:${Math.round(x)}`;
        if (byBucket.has(bucket)) continue;

        byBucket.set(bucket, {
          id: `${entry.id}:${lane}`,
          lane,
          x: clamp(x, 1, Math.max(1, overviewWidth - 1)),
          color: entry.color || null
        });
      }
    }

    return Array.from(byBucket.values());
  }, [filteredEntries, mode, overviewRange.end, overviewRange.span, overviewRange.start, overviewWidth]);

  const activeEraIds = useMemo(() => {
    const set = new Set();
    for (const entry of entries) {
      for (const era of HISTORICAL_ERAS) {
        const sy = entry.settingStart ?? entry.settingEnd;
        const py = entry.productionStart ?? entry.productionEnd;
        if (Number.isFinite(sy) && sy <= era.end && (entry.settingEnd ?? sy) >= era.start) set.add(era.id);
        if (Number.isFinite(py) && py >= era.start && py <= era.end) set.add(era.id);
      }
    }
    return set;
  }, [entries]);

  const scatterBounds = useMemo(() => {
    let minProd = Infinity, maxProd = -Infinity, minSet = Infinity, maxSet = -Infinity;
    for (const entry of entries) {
      const py = entry.productionStart ?? entry.productionEnd;
      const sy = entry.settingStart ?? entry.settingEnd;
      if (Number.isFinite(py)) { minProd = Math.min(minProd, py); maxProd = Math.max(maxProd, py); }
      if (Number.isFinite(sy)) { minSet = Math.min(minSet, sy); maxSet = Math.max(maxSet, sy); }
    }
    if (!isFinite(minProd)) return null;
    const pad = 20;
    return {
      minX: minProd - pad, maxX: maxProd + pad,
      minY: Math.min(minProd, minSet) - pad,
      maxY: Math.max(maxProd, maxSet) + pad
    };
  }, [entries]);

  const scatterPoints = useMemo(() => {
    if (!scatterBounds) return [];
    return entries
      .map(entry => {
        const px = entry.productionStart ?? entry.productionEnd;
        const sy = entry.settingStart ?? entry.settingEnd;
        if (!Number.isFinite(px) || !Number.isFinite(sy)) return null;
        return { entry, px, sy };
      })
      .filter(Boolean);
  }, [entries, scatterBounds]);

  const lanes = useMemo(() => {
    const centerY = canvasRect.height / 2;

    if (mode === MODE_BOTH) {
      return {
        [MODE_PRODUCTION]: centerY - 72,
        [MODE_SETTING]: centerY + 72
      };
    }

    if (mode === MODE_SETTING) {
      return {
        [MODE_SETTING]: centerY
      };
    }

    return {
      [MODE_PRODUCTION]: centerY
    };
  }, [canvasRect.height, mode]);

  const viewportBufferedRange = useMemo(() => {
    const pad = Math.max(timelineState.span * VIEWPORT_BUFFER_RATIO, VIEWPORT_BUFFER_MIN_YEARS);
    return {
      start: viewStart - pad,
      end: viewEnd + pad
    };
  }, [timelineState.span, viewEnd, viewStart]);

  const markers = useMemo(() => {
    const output = [];

    for (const entry of filteredEntries) {
      const lanesToRender = mode === MODE_BOTH ? [MODE_PRODUCTION, MODE_SETTING] : [mode];

      for (const lane of lanesToRender) {
        const rawStart = lane === MODE_SETTING ? entry.settingStart : entry.productionStart;
        const rawEnd = lane === MODE_SETTING ? entry.settingEnd : entry.productionEnd;

        if (!Number.isFinite(rawStart) && !Number.isFinite(rawEnd)) continue;

        const safeStart = Number.isFinite(rawStart) ? rawStart : rawEnd;
        const safeEnd = Number.isFinite(rawEnd) ? rawEnd : rawStart;
        if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) continue;

        const rangeStart = Math.min(safeStart, safeEnd);
        const rangeEnd = Math.max(safeStart, safeEnd);
        if (!intersects(rangeStart, rangeEnd, viewportBufferedRange.start, viewportBufferedRange.end)) continue;

        output.push({
          id: `${entry.id}:${lane}`,
          entryId: entry.id,
          lane,
          lineY: lanes[lane],
          nodeY: (lanes[lane] ?? canvasRect.height / 2) + laneNodeOffset(lane),
          primaryYear: rangeStart,
          rangeStart,
          rangeEnd,
          xStart: toX(rangeStart, viewStart, timelineState.span, canvasRect.width),
          xEnd: toX(rangeEnd, viewStart, timelineState.span, canvasRect.width),
          color: entry.color || null,
          mediaType: entry.mediaType,
          title: entry.title
        });
      }
    }

    return output;
  }, [canvasRect.width, filteredEntries, lanes, mode, timelineState.span, viewStart, viewportBufferedRange.end, viewportBufferedRange.start]);

  const markersByLane = useMemo(() => {
    const grouped = {
      [MODE_PRODUCTION]: [],
      [MODE_SETTING]: []
    };
    for (const marker of markers) {
      grouped[marker.lane].push(marker);
    }
    return grouped;
  }, [markers]);

  const visibleEntryCount = useMemo(() => {
    const ids = new Set(markers.map((marker) => marker.entryId));
    return ids.size;
  }, [markers]);

  const laneCaps = useMemo(() => {
    if (mode === MODE_PRODUCTION) {
      return {
        [MODE_PRODUCTION]: MAX_RENDERED_NODES,
        [MODE_SETTING]: 0
      };
    }

    if (mode === MODE_SETTING) {
      return {
        [MODE_PRODUCTION]: 0,
        [MODE_SETTING]: MAX_RENDERED_NODES
      };
    }

    return allocateLaneCaps(markersByLane[MODE_PRODUCTION].length, markersByLane[MODE_SETTING].length, MAX_RENDERED_NODES);
  }, [markersByLane, mode]);

  const clustersByLane = useMemo(() => {
    const pixelBuffer = Math.max(50, canvasRect.width * VIEWPORT_BUFFER_RATIO);
    const minX = -pixelBuffer;
    const maxX = canvasRect.width + pixelBuffer;
    const inBufferedViewport = (item) => item.x >= minX && item.x <= maxX;

    return {
      [MODE_PRODUCTION]: buildLaneRenderItems(
        markersByLane[MODE_PRODUCTION],
        laneCaps[MODE_PRODUCTION],
        viewStart,
        timelineState.span,
        canvasRect.width
      ).filter(inBufferedViewport),
      [MODE_SETTING]: buildLaneRenderItems(
        markersByLane[MODE_SETTING],
        laneCaps[MODE_SETTING],
        viewStart,
        timelineState.span,
        canvasRect.width
      ).filter(inBufferedViewport)
    };
  }, [canvasRect.width, laneCaps, markersByLane, timelineState.span, viewStart]);

  const allRenderItems = useMemo(() => {
    const combined = [...(clustersByLane[MODE_PRODUCTION] || []), ...(clustersByLane[MODE_SETTING] || [])].sort((a, b) => a.x - b.x);
    const sampled = combined.length <= MAX_RENDERED_NODES ? combined : sampleItemsEvenly(combined, MAX_RENDERED_NODES).sort((a, b) => a.x - b.x);
    return capRenderItemsByUnits(sampled, timelineState.span, MAX_RENDERED_NODES);
  }, [clustersByLane, timelineState.span]);

  const visibleRenderItems = useMemo(() => {
    const minY = -100;
    const maxY = canvasRect.height + 100;

    return allRenderItems.filter((item) => {
      const laneY = lanes[item.lane] ?? canvasRect.height / 2;
      return Number.isFinite(laneY) && laneY >= minY && laneY <= maxY;
    });
  }, [allRenderItems, canvasRect.height, lanes]);

  const hoveredHeadline = useMemo(() => {
    if (hoveredEntryId) {
      const entry = entries.find((item) => item.id === hoveredEntryId);
      if (entry?.title) return entry.title;
    }
    if (hoveredClusterId) {
      const cluster = visibleRenderItems.find((item) => item.type === "cluster" && item.id === hoveredClusterId);
      if (cluster) return formatClusterLabel(cluster);
    }
    return "";
  }, [entries, hoveredClusterId, hoveredEntryId, visibleRenderItems]);

  const baseRenderedUnits = useMemo(() => countRenderUnits(visibleRenderItems, timelineState.span), [timelineState.span, visibleRenderItems]);

  const clusterMap = useMemo(() => {
    const map = new Map();
    for (const item of visibleRenderItems) {
      if (item.type === "cluster") map.set(item.id, item);
    }
    return map;
  }, [visibleRenderItems]);

  useEffect(() => {
    if (expandedClusterId && !clusterMap.has(expandedClusterId)) setExpandedClusterId(null);
    if (gridClusterId && !clusterMap.has(gridClusterId)) setGridClusterId(null);
  }, [clusterMap, expandedClusterId, gridClusterId]);

  useEffect(() => {
    // Prevent stale floating branch artifacts when switching timeline modes.
    setExpandedClusterId(null);
    setExpandedBranchType(null);
  }, [mode, viewMode]);

  useEffect(() => {
    if (hoveredClusterId && !clusterMap.has(hoveredClusterId)) {
      setHoveredClusterId(null);
    }
  }, [clusterMap, hoveredClusterId]);

  const expandedCluster = expandedClusterId ? clusterMap.get(expandedClusterId) : null;
  const gridCluster = gridClusterId ? clusterMap.get(gridClusterId) : null;

  const ticks = useMemo(() => {
    const step = getTickStep(timelineState.span, showMonthResolution);
    const first = Math.floor(viewStart / step) * step;
    const values = [];

    for (let value = first; value <= viewEnd + step; value += step) {
      if (value < viewStart - step) continue;
      values.push(Number(value.toFixed(5)));
    }

    return { step, values };
  }, [timelineState.span, viewEnd, viewStart, showMonthResolution]);

  const rangeLines = useMemo(() => {
    return visibleRenderItems
      .filter((item) => item.type === "node")
      .filter((item) => item.marker.rangeEnd > item.marker.rangeStart)
      .map((item) => ({
        marker: item.marker,
        resolution: item.resolution || "year"
      }));
  }, [visibleRenderItems]);

  const entryById = useMemo(() => {
    const map = new Map();
    for (const entry of entries) map.set(entry.id, entry);
    return map;
  }, [entries]);

  const expandedBranchData = useMemo(() => {
    if (!expandedCluster) {
      return {
        lane: null,
        groups: [],
        activeGroup: null,
        activeEntries: []
      };
    }

    const ids = Array.from(new Set(expandedCluster.markers.map((marker) => marker.entryId)));
    let branchBudget = Math.max(0, MAX_RENDERED_NODES - baseRenderedUnits);
    const lane = expandedCluster.lane;
    const laneEntries = [];

    for (const id of ids) {
      if (branchBudget <= 0) break;
      const entry = entryById.get(id);
      if (!entry) continue;

      const year =
        lane === MODE_PRODUCTION
          ? (entry.productionStart ?? entry.productionEnd)
          : (entry.settingStart ?? entry.settingEnd);
      if (!Number.isFinite(year)) continue;
      laneEntries.push({ entry, year });
      branchBudget -= 1;
    }

    const byType = new Map();
    for (const item of laneEntries) {
      const typeId = item.entry.mediaType || "article";
      if (!byType.has(typeId)) byType.set(typeId, []);
      byType.get(typeId).push(item);
    }

    const groups = Array.from(byType.entries())
      .map(([mediaType, items]) => ({
        mediaType,
        label: getType(mediaType).label,
        items: items.sort((a, b) => a.year - b.year),
        count: items.length
      }))
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

    const activeGroup = groups.find((group) => group.mediaType === expandedBranchType) || null;

    return {
      lane,
      groups,
      activeGroup,
      activeEntries: activeGroup ? activeGroup.items : []
    };
  }, [baseRenderedUnits, entryById, expandedBranchType, expandedCluster]);

  useEffect(() => {
    if (!expandedBranchType) return;
    if (!expandedBranchData.groups.some((group) => group.mediaType === expandedBranchType)) {
      setExpandedBranchType(null);
    }
  }, [expandedBranchData.groups, expandedBranchType]);

  const gridEntries = useMemo(() => {
    if (!gridCluster) return [];
    const ids = Array.from(new Set(gridCluster.markers.map((marker) => marker.entryId)));
    return ids.map((id) => entryById.get(id)).filter(Boolean);
  }, [entryById, gridCluster]);

  const popupAnchorPoint = useMemo(() => {
    if (!selectedEntry || !popupAnchor || !canvasRef.current) return null;

    const canvasBox = canvasRef.current.getBoundingClientRect();
    const laneY = (lanes[popupAnchor.lane] ?? Math.min(...Object.values(lanes))) + laneNodeOffset(popupAnchor.lane);
    const fallback = getEntryFocusTarget(selectedEntry, popupAnchor.lane);
    const year = Number.isFinite(popupAnchor.year) ? popupAnchor.year : fallback?.year;
    if (!Number.isFinite(year)) return null;

    const x = clamp(canvasBox.left + toX(year, viewStart, timelineState.span, canvasRect.width), canvasBox.left + 8, canvasBox.right - 8);
    const y = clamp(canvasBox.top + laneY, canvasBox.top + 8, canvasBox.bottom - 8);
    const timelineTop = canvasBox.top + Math.min(...Object.values(lanes));

    return { x, y, timelineTop };
  }, [canvasRect.width, lanes, popupAnchor, selectedEntry, timelineState.span, viewStart]);

  const popupGeometry = useMemo(() => {
    if (!popupAnchorPoint) return null;

    const margin = 14;
    const maxLeft = Math.max(margin, window.innerWidth - popupSize.width - margin);
    const left = clamp(popupAnchorPoint.x - popupSize.width / 2, margin, maxLeft);
    const desiredTop = popupAnchorPoint.y - popupSize.height - 72;
    const maxTopAboveTimeline = popupAnchorPoint.timelineTop - popupSize.height - 20;
    const maxTop = Math.max(margin, Math.min(window.innerHeight - popupSize.height - margin, maxTopAboveTimeline));
    const top = clamp(desiredTop, margin, maxTop);
    const calloutStartX = clamp(popupAnchorPoint.x, left + 18, left + popupSize.width - 18);
    const calloutStartY = top + popupSize.height - 1;
    const calloutEndY = Math.max(calloutStartY + 8, popupAnchorPoint.y - 10);

    return {
      left,
      top,
      calloutStartX,
      calloutStartY,
      calloutEndX: popupAnchorPoint.x,
      calloutEndY
    };
  }, [popupAnchorPoint, popupSize.height, popupSize.width]);

  const selectedDualLink = useMemo(() => {
    if (mode !== MODE_BOTH || !selectedEntry) return null;

    const productionYear = selectedEntry.productionStart ?? selectedEntry.productionEnd;
    const settingYear = selectedEntry.settingStart ?? selectedEntry.settingEnd;
    if (!Number.isFinite(productionYear) || !Number.isFinite(settingYear)) return null;

    const x1 = toX(productionYear, viewStart, timelineState.span, canvasRect.width);
    const x2 = toX(settingYear, viewStart, timelineState.span, canvasRect.width);
    const y1 = (lanes[MODE_PRODUCTION] ?? canvasRect.height / 2) + laneNodeOffset(MODE_PRODUCTION);
    const y2 = (lanes[MODE_SETTING] ?? canvasRect.height / 2) + laneNodeOffset(MODE_SETTING);

    if (Math.max(x1, x2) < -120 || Math.min(x1, x2) > canvasRect.width + 120) return null;

    return { x1, y1, x2, y2 };
  }, [canvasRect.height, canvasRect.width, lanes, mode, selectedEntry, timelineState.span, viewStart]);

  async function runInferenceQueue() {
    if (inferenceRunningRef.current) return;
    inferenceRunningRef.current = true;

    async function processOne() {
      while (inferenceQueueRef.current.length > 0) {
        const id = inferenceQueueRef.current.shift();
        inferenceQueuedSetRef.current.delete(id);

        if (!id || inferenceInFlightSetRef.current.has(id)) continue;

        const snapshot = entriesRef.current.find((entry) => entry.id === id);
        if (!shouldInferSetting(snapshot)) continue;

        inferenceInFlightSetRef.current.add(id);
        setInferenceUi((current) => ({ ...current, running: current.running + 1, queued: Math.max(0, current.queued - 1) }));

        setEntries((current) =>
          current.map((entry) => (entry.id === id && !entry.settingUserLocked ? { ...entry, inferenceStatus: "running" } : entry))
        );

        let result = null;
        try {
          result = await inferSettingFromSources(snapshot, presentYear);
        } catch {
          result = null;
        }

        setEntries((current) =>
          current.map((entry) => {
            if (entry.id !== id) return entry;

            if (entry.settingUserLocked) {
              return {
                ...entry,
                inferenceStatus: "done"
              };
            }

            if (!result) {
              return {
                ...entry,
                inferenceStatus: "failed"
              };
            }

            const currentConfidence = Number.isFinite(entry.settingConfidence) ? entry.settingConfidence : 0;
            const keepExisting = Number.isFinite(entry.settingStart) && !entry.settingAuto && entry.settingSource !== "heuristic";
            if (keepExisting) {
              return {
                ...entry,
                inferenceStatus: "done"
              };
            }

            if (Number.isFinite(entry.settingStart) && currentConfidence > result.confidence && entry.settingSource !== "heuristic") {
              return {
                ...entry,
                inferenceStatus: "done"
              };
            }

            return {
              ...entry,
              settingStart: result.settingStart,
              settingEnd: result.settingEnd,
              settingSource: result.source,
              settingConfidence: result.confidence,
              settingAuto: true,
              settingUserLocked: false,
              inferenceStatus: "done"
            };
          })
        );

        setInferenceUi((current) => ({
          ...current,
          running: Math.max(0, current.running - 1),
          resolved: result ? current.resolved + 1 : current.resolved,
          failed: result ? current.failed : current.failed + 1
        }));

        inferenceInFlightSetRef.current.delete(id);
      }
    }

    await Promise.all([processOne(), processOne()]);
    inferenceRunningRef.current = false;
  }

  function enqueueInference(ids) {
    const unique = Array.from(new Set(ids));
    let added = 0;

    for (const id of unique) {
      if (!id) continue;
      if (inferenceQueuedSetRef.current.has(id) || inferenceInFlightSetRef.current.has(id)) continue;

      const snapshot = entriesRef.current.find((entry) => entry.id === id);
      if (!shouldInferSetting(snapshot)) continue;

      inferenceQueueRef.current.push(id);
      inferenceQueuedSetRef.current.add(id);
      added += 1;
    }

    if (added > 0) {
      setInferenceUi((current) => ({ ...current, queued: current.queued + added }));
      setEntries((current) =>
        current.map((entry) =>
          unique.includes(entry.id) && shouldInferSetting(entry)
            ? {
                ...entry,
                inferenceStatus: entry.inferenceStatus === "running" ? "running" : "pending"
              }
            : entry
        )
      );
    }

    void runInferenceQueue();
  }

  function applyTimelineWindow(nextStart, nextSpan = timelineState.span) {
    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const span = clamp(nextSpan, 0.4, maxSpan);
    const maxStart = overviewRange.end - span;
    const start = clamp(nextStart, overviewRange.start, maxStart);

    setTimelineState((current) => ({
      ...current,
      span,
      end: start + span
    }));
  }

  function animateTimelineToYear(targetYear, targetSpan = timelineState.span, onComplete) {
    if (!Number.isFinite(targetYear)) return;
    if (centerMoveRafRef.current) {
      window.cancelAnimationFrame(centerMoveRafRef.current);
      centerMoveRafRef.current = null;
    }

    const fromSpan = timelineState.span;
    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const toSpan = clamp(targetSpan, 0.4, maxSpan);
    pendingZoomSpanRef.current = toSpan;
    const maxStart = overviewRange.end - toSpan;
    const toStart = clamp(targetYear - toSpan / 2, overviewRange.start, maxStart);
    const fromStart = viewStart;
    const startTime = performance.now();
    const duration = 380;

    const step = (now) => {
      const t = clamp((now - startTime) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextStart = fromStart + (toStart - fromStart) * eased;
      const nextSpan = fromSpan + (toSpan - fromSpan) * eased;
      applyTimelineWindow(nextStart, nextSpan);

      if (t < 1) {
        centerMoveRafRef.current = window.requestAnimationFrame(step);
      } else {
        centerMoveRafRef.current = null;
        pendingZoomSpanRef.current = toSpan;
        if (typeof onComplete === "function") onComplete();
      }
    };

    centerMoveRafRef.current = window.requestAnimationFrame(step);
  }

  function animateTimelineToWindow(targetStart, targetSpan = timelineState.span, onComplete) {
    if (!Number.isFinite(targetStart) || !Number.isFinite(targetSpan)) return;
    if (centerMoveRafRef.current) {
      window.cancelAnimationFrame(centerMoveRafRef.current);
      centerMoveRafRef.current = null;
    }

    const fromSpan = pendingZoomSpanRef.current;
    const fromStart = pendingViewStartRef.current;
    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const toSpan = clamp(targetSpan, 0.4, maxSpan);
    const maxStart = overviewRange.end - toSpan;
    const toStart = clamp(targetStart, overviewRange.start, maxStart);
    const startTime = performance.now();
    const duration = 320;

    const step = (now) => {
      const t = clamp((now - startTime) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextStart = fromStart + (toStart - fromStart) * eased;
      const nextSpan = fromSpan + (toSpan - fromSpan) * eased;
      pendingViewStartRef.current = nextStart;
      pendingZoomSpanRef.current = nextSpan;
      applyTimelineWindow(nextStart, nextSpan);

      if (t < 1) {
        centerMoveRafRef.current = window.requestAnimationFrame(step);
      } else {
        centerMoveRafRef.current = null;
        pendingViewStartRef.current = toStart;
        pendingZoomSpanRef.current = toSpan;
        if (typeof onComplete === "function") onComplete();
      }
    };

    centerMoveRafRef.current = window.requestAnimationFrame(step);
  }

  function scheduleTimelineWindow(nextStart, nextSpan = timelineState.span) {
    scheduledWindowRef.current = { start: nextStart, span: nextSpan };
    if (scheduledWindowRafRef.current) return;

    scheduledWindowRafRef.current = window.requestAnimationFrame(() => {
      const payload = scheduledWindowRef.current;
      scheduledWindowRef.current = null;
      scheduledWindowRafRef.current = null;
      if (!payload) return;
      applyTimelineWindow(payload.start, payload.span);
    });
  }

  function updateSpan(nextSpan, clientX = null) {
    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const span = clamp(nextSpan, 0.4, maxSpan);

    let anchorRatio = 0.5;
    if (Number.isFinite(clientX) && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      anchorRatio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    }

    // Use refs to avoid stale closures during rapid wheel events
    const anchorYear = pendingViewStartRef.current + anchorRatio * pendingZoomSpanRef.current;
    const nextStart = anchorYear - anchorRatio * span;
    pendingZoomSpanRef.current = span;
    pendingViewStartRef.current = nextStart;
    scheduleTimelineWindow(nextStart, span);
  }

  function findDensestYear(entriesArr, modeKey) {
    const years = entriesArr
      .map(e => modeKey === MODE_SETTING ? e.settingStart : e.productionStart)
      .filter(y => Number.isFinite(y));
    if (years.length === 0) return null;
    const windowSize = 40;
    let bestCenter = years[Math.floor(years.length / 2)];
    let bestCount = 0;
    for (const year of years) {
      const count = years.filter(y => Math.abs(y - year) <= windowSize / 2).length;
      if (count > bestCount) { bestCount = count; bestCenter = year; }
    }
    return bestCenter;
  }

  function resetCompass() {
    setTimelineState(defaultState(presentYear));
  }

  function onWheelNavigate(event) {
    event.preventDefault();

    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);

    if (event.metaKey || event.ctrlKey) {
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      updateSpan(pendingZoomSpanRef.current * factor, event.clientX);
      return;
    }

    if (absY > absX && absY > 0) {
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      updateSpan(pendingZoomSpanRef.current * factor, event.clientX);
      return;
    }

    if (absX > 0) {
      const yearsPerPixel = pendingZoomSpanRef.current / Math.max(1, canvasRect.width);
      const deltaYears = event.deltaX * yearsPerPixel * 1.25;
      const nextStart = pendingViewStartRef.current + deltaYears;
      pendingViewStartRef.current = nextStart;
      scheduleTimelineWindow(nextStart, pendingZoomSpanRef.current);
    }
  }

  function onDragStart(event) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, input, select, textarea, .sheet, .cluster-grid-sheet, .overview-navigator-wrap")
    ) {
      return;
    }

    zoomDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startViewStart: pendingViewStartRef.current,
      span: pendingZoomSpanRef.current
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDragMove(event) {
    if (!zoomDragRef.current) return;

    const dx = event.clientX - zoomDragRef.current.startX;
    const dy = event.clientY - zoomDragRef.current.startY;

    // Vertical drag: up = zoom in (smaller span), down = zoom out
    const zoomFactor = Math.exp(dy * 0.005);
    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const newSpan = clamp(zoomDragRef.current.span * zoomFactor, 0.4, maxSpan);

    // Horizontal drag: pan
    const deltaYears = (dx / Math.max(1, canvasRect.width)) * newSpan;
    const nextStart = zoomDragRef.current.startViewStart - deltaYears;

    pendingZoomSpanRef.current = newSpan;
    pendingViewStartRef.current = nextStart;
    scheduleTimelineWindow(nextStart, newSpan);
  }

  function onDragEnd(event) {
    zoomDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onOverviewWheel(event) {
    event.preventDefault();
    const yearsPerPixel = overviewRange.span / Math.max(1, overviewWidth);
    const deltaYears = event.deltaX * yearsPerPixel * 1.2;
    const nextStart = pendingViewStartRef.current + deltaYears;
    pendingViewStartRef.current = nextStart;
    scheduleTimelineWindow(nextStart, pendingZoomSpanRef.current);
  }

  function onOverviewClick(event) {
    if (!overviewRef.current) return;

    const rect = overviewRef.current.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const ratio = x / rect.width;
    const targetYear = overviewRange.start + ratio * overviewRange.span;

    const nextStart = targetYear - timelineState.span / 2;
    scheduleTimelineWindow(nextStart, timelineState.span);
  }

  function onOverviewRectDown(event) {
    event.stopPropagation();

    if (!overviewRef.current) return;
    const rect = overviewRef.current.getBoundingClientRect();

    overviewRectDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startViewStart: pendingViewStartRef.current,
      startSpan: pendingZoomSpanRef.current,
      startCenter: pendingViewStartRef.current + pendingZoomSpanRef.current / 2,
      moved: false,
      rectWidth: rect.width
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onOverviewRectMove(event) {
    if (!overviewRectDragRef.current) return;
    const dx = event.clientX - overviewRectDragRef.current.startX;
    const dy = event.clientY - overviewRectDragRef.current.startY;
    if (Math.abs(dx) > 1) overviewRectDragRef.current.moved = true;

    // Mini-map behavior: drag up = zoom out, drag down = zoom in.
    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const zoomFactor = Math.exp(-dy * 0.005);
    const nextSpan = clamp(overviewRectDragRef.current.startSpan * zoomFactor, 0.4, maxSpan);

    const deltaYear = (dx / overviewRectDragRef.current.rectWidth) * overviewRange.span;
    const nextStartFromCenter = overviewRectDragRef.current.startCenter - nextSpan / 2;
    const nextStart = nextStartFromCenter + deltaYear;

    pendingZoomSpanRef.current = nextSpan;
    pendingViewStartRef.current = nextStart;
    scheduleTimelineWindow(nextStart, nextSpan);
  }

  function onOverviewRectUp(event) {
    if (overviewRectDragRef.current?.pointerId !== event.pointerId) return;
    overviewRectDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onOverviewEdgeDown(side, event) {
    event.stopPropagation();
    if (!overviewRef.current) return;
    const rect = overviewRef.current.getBoundingClientRect();
    const start = pendingViewStartRef.current;
    const span = pendingZoomSpanRef.current;
    overviewEdgeDragRef.current = {
      pointerId: event.pointerId,
      side,
      startX: event.clientX,
      rectWidth: rect.width,
      start,
      end: start + span
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onOverviewEdgeMove(event) {
    const drag = overviewEdgeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const maxSpan = Math.max(0.4, overviewRange.end - overviewRange.start);
    const minSpan = Math.max(0.4, (24 / Math.max(1, drag.rectWidth)) * overviewRange.span);
    const dx = event.clientX - drag.startX;
    const deltaYear = (dx / Math.max(1, drag.rectWidth)) * overviewRange.span;

    if (drag.side === "left") {
      const maxStart = drag.end - minSpan;
      const nextStart = clamp(drag.start + deltaYear, overviewRange.start, maxStart);
      const nextSpan = clamp(drag.end - nextStart, minSpan, maxSpan);
      pendingViewStartRef.current = nextStart;
      pendingZoomSpanRef.current = nextSpan;
      scheduleTimelineWindow(nextStart, nextSpan);
      return;
    }

    const minEnd = drag.start + minSpan;
    const nextEnd = clamp(drag.end + deltaYear, minEnd, overviewRange.end);
    const nextSpan = clamp(nextEnd - drag.start, minSpan, maxSpan);
    pendingViewStartRef.current = drag.start;
    pendingZoomSpanRef.current = nextSpan;
    scheduleTimelineWindow(drag.start, nextSpan);
  }

  function onOverviewEdgeUp(event) {
    const drag = overviewEdgeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    overviewEdgeDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onOverviewResizeDown(event) {
    overviewResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: overviewHeight
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onOverviewResizeMove(event) {
    if (!overviewResizeRef.current) return;
    const dy = event.clientY - overviewResizeRef.current.startY;
    const nextHeight = clamp(overviewResizeRef.current.startHeight - dy, 34, 180);
    setOverviewHeight(nextHeight);
  }

  function onOverviewResizeUp(event) {
    if (overviewResizeRef.current?.pointerId !== event.pointerId) return;
    overviewResizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function searchWikidataEntities(query) {
    if (!query || query.length < 2) return [];
    try {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&origin=*&type=item&limit=7`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.search || []).map(item => ({
        id: item.id,
        label: item.label || "",
        description: item.description || "",
      }));
    } catch {
      return [];
    }
  }

  async function fetchWikidataEntity(qid) {
    try {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&languages=en&format=json&origin=*&props=claims|labels`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const entity = data.entities?.[qid];
      if (!entity) return null;
      const claims = entity.claims || {};

      // Extract production year from P577 (pub date), P571 (inception), P580 (start time)
      let productionYear = null;
      for (const prop of ["P577", "P571", "P580"]) {
        const val = claims[prop]?.[0]?.mainsnak?.datavalue?.value;
        if (val?.time) {
          const m = val.time.match(/^[+-](\d{4})/);
          if (m) { productionYear = Number(m[1]); break; }
        }
      }

      // Extract setting years P580/P582
      let settingStart = null, settingEnd = null;
      const p580 = claims["P580"]?.[0]?.mainsnak?.datavalue?.value;
      const p582 = claims["P582"]?.[0]?.mainsnak?.datavalue?.value;
      if (p580?.time) {
        const m = p580.time.match(/^[+-](\d{4})/);
        if (m) settingStart = Number(m[1]);
      }
      if (p582?.time) {
        const m = p582.time.match(/^[+-](\d{4})/);
        if (m) settingEnd = Number(m[1]);
      }

      // Media type from P31 (instance of)
      const instanceClaims = (claims["P31"] || []).map(c => c.mainsnak?.datavalue?.value?.id);
      let mediaType = null;
      if (instanceClaims.includes("Q11424") || instanceClaims.includes("Q24869")) mediaType = "movie";
      else if (instanceClaims.includes("Q5398426") || instanceClaims.includes("Q63952888")) mediaType = "television";
      else if (instanceClaims.some(id => ["Q571", "Q7725634", "Q8261"].includes(id))) mediaType = "book";
      else if (instanceClaims.includes("Q1277575")) mediaType = "podcast";

      // Creator from P57 (director), P50 (author), P170 (creator)
      let creator = "";
      for (const prop of ["P57", "P50", "P170"]) {
        const creatorId = claims[prop]?.[0]?.mainsnak?.datavalue?.value?.id;
        if (creatorId) {
          try {
            const cr = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${creatorId}&languages=en&format=json&origin=*&props=labels`);
            const cd = await cr.json();
            creator = cd.entities?.[creatorId]?.labels?.en?.value || "";
            if (creator) break;
          } catch { /* ignore */ }
        }
      }

      return { productionYear, settingStart, settingEnd, mediaType, creator };
    } catch {
      return null;
    }
  }

  function onAddTitleChange(value) {
    setAddField("title", value);
    if (titleSearchTimerRef.current) clearTimeout(titleSearchTimerRef.current);
    if (!value || value.length < 2) {
      setTitleSuggestions([]);
      return;
    }
    setTitleSearchLoading(true);
    titleSearchTimerRef.current = setTimeout(async () => {
      const results = await searchWikidataEntities(value);
      setTitleSuggestions(results);
      setTitleSearchLoading(false);
    }, 380);
  }

  async function onSelectTitleSuggestion(suggestion) {
    setAddField("title", suggestion.label);
    setTitleSuggestions([]);
    setTitleSearchLoading(true);
    const details = await fetchWikidataEntity(suggestion.id);
    setTitleSearchLoading(false);
    if (!details) return;
    setAddDraft(current => ({
      ...current,
      title: suggestion.label,
      ...(details.mediaType ? { mediaType: details.mediaType } : {}),
      ...(details.creator ? { creator: details.creator } : {}),
      ...(Number.isFinite(details.productionYear) ? { productionStart: String(details.productionYear), productionEnd: String(details.productionYear) } : {}),
      ...(Number.isFinite(details.settingStart) ? { settingStart: String(details.settingStart) } : {}),
      ...(Number.isFinite(details.settingEnd) ? { settingEnd: String(details.settingEnd) } : {}),
    }));
  }

  function setAddField(field, value) {
    setAddDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function addEntry(entry, burstType = "manual") {
    setEntries((current) => [entry, ...current]);

    setBurstMap((current) => ({
      ...current,
      [entry.id]: burstType
    }));

    window.setTimeout(() => {
      setBurstMap((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    }, 900);
  }

  function maybeLaunchFlight(entry) {
    if (!addButtonRef.current || !canvasRef.current) return;

    const buttonRect = addButtonRef.current.getBoundingClientRect();
    const canvasBox = canvasRef.current.getBoundingClientRect();

    const lane = mode === MODE_SETTING ? MODE_SETTING : MODE_PRODUCTION;
    const targetYear = lane === MODE_SETTING ? entry.settingStart : entry.productionStart;
    if (!Number.isFinite(targetYear)) return;

    const targetX = toX(targetYear, viewStart, timelineState.span, canvasRect.width);
    const targetY = lanes[lane] ?? canvasRect.height / 2;

    const startX = buttonRect.left + buttonRect.width / 2 - canvasBox.left;
    const startY = buttonRect.top + buttonRect.height / 2 - canvasBox.top;

    setFlight({
      id: entry.id,
      color: entry.color || null,
      startX,
      startY,
      dx: targetX - startX,
      dy: targetY - startY
    });

    window.setTimeout(() => setFlight(null), 820);
  }

  function handleAddSubmit(event) {
    event.preventDefault();

    const productionStart = toYear(addDraft.productionStart);
    const productionEnd = toYear(addDraft.productionEnd) ?? productionStart;

    const rawSettingStart = toYear(addDraft.settingStart);
    const rawSettingEnd = toYear(addDraft.settingEnd) ?? rawSettingStart;

    const hasManualSetting = Number.isFinite(rawSettingStart) || Number.isFinite(rawSettingEnd);

    const entry = {
      id: toEntryId("manual"),
      mediaType: addDraft.mediaType,
      title: addDraft.title.trim(),
      creator: addDraft.creator.trim(),
      productionStart,
      productionEnd,
      settingStart: hasManualSetting ? rawSettingStart : null,
      settingEnd: hasManualSetting ? rawSettingEnd : null,
      source: "manual",
      settingSource: hasManualSetting ? "manual" : null,
      settingConfidence: hasManualSetting ? null : null,
      settingAuto: false,
      settingUserLocked: hasManualSetting,
      inferenceStatus: hasManualSetting ? "done" : "idle",
      notes: addDraft.notes?.trim() ?? "",
      tags: addDraft.tags ? addDraft.tags.split(",").map(t => t.trim()).filter(Boolean) : []
    };

    if (!entry.title) return;
    if (!Number.isFinite(entry.productionStart) && !Number.isFinite(entry.settingStart)) return;

    addEntry(entry, "manual");
    maybeLaunchFlight(entry);

    if (!hasManualSetting) {
      window.setTimeout(() => enqueueInference([entry.id]), 50);
    }

    setAddDraft((current) => ({
      ...current,
      title: "",
      creator: "",
      productionStart: "",
      productionEnd: "",
      settingStart: "",
      settingEnd: "",
      notes: "",
      tags: ""
    }));
  }

  function closePopup() {
    if (!selectedEntryId) return;

    const restore = preZoomStateRef.current;
    if (restore) {
      animateTimelineToWindow(restore.viewStart, restore.span);
      preZoomStateRef.current = null;
      setPreZoomState(null);
    }

    setPopupClosing(true);
    if (popupCloseTimerRef.current) window.clearTimeout(popupCloseTimerRef.current);
    popupCloseTimerRef.current = window.setTimeout(() => {
      setSelectedEntryId(null);
      setPopupAnchor(null);
      setEditMode(false);
      setPopupClosing(false);
      setInlineNotesOpen(false);
      setInlineNotesDraft("");
      setAddingTag(false);
      setTagInput("");
      setHoveredEntryId(null);
      setHoveredClusterId(null);
      popupCloseTimerRef.current = null;
    }, 240);
  }

  function closePopupImmediate() {
    if (popupCloseTimerRef.current) {
      window.clearTimeout(popupCloseTimerRef.current);
      popupCloseTimerRef.current = null;
    }
    if (titleSearchTimerRef.current) {
      clearTimeout(titleSearchTimerRef.current);
      titleSearchTimerRef.current = null;
    }
    const restore = preZoomStateRef.current;
    if (restore) {
      animateTimelineToWindow(restore.viewStart, restore.span);
      preZoomStateRef.current = null;
      setPreZoomState(null);
    }
    setPopupClosing(false);
    setSelectedEntryId(null);
    setPopupAnchor(null);
    setHoveredEntryId(null);
    setHoveredClusterId(null);
    setEditMode(false);
  }

  function getEventOrigin(event) {
    if (!event?.currentTarget?.getBoundingClientRect) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  function getEntryFocusTarget(entry, preferredLane) {
    if (!entry) return null;

    if (preferredLane === MODE_SETTING) {
      const year = entry.settingStart ?? entry.settingEnd ?? entry.productionStart ?? entry.productionEnd;
      if (Number.isFinite(year)) return { lane: MODE_SETTING, year };
    }

    if (preferredLane === MODE_PRODUCTION) {
      const year = entry.productionStart ?? entry.productionEnd ?? entry.settingStart ?? entry.settingEnd;
      if (Number.isFinite(year)) return { lane: MODE_PRODUCTION, year };
    }

    if (mode === MODE_SETTING) {
      const year = entry.settingStart ?? entry.settingEnd ?? entry.productionStart ?? entry.productionEnd;
      if (Number.isFinite(year)) return { lane: MODE_SETTING, year };
    }

    if (mode === MODE_PRODUCTION) {
      const year = entry.productionStart ?? entry.productionEnd ?? entry.settingStart ?? entry.settingEnd;
      if (Number.isFinite(year)) return { lane: MODE_PRODUCTION, year };
    }

    const productionYear = entry.productionStart ?? entry.productionEnd;
    if (Number.isFinite(productionYear)) return { lane: MODE_PRODUCTION, year: productionYear };

    const settingYear = entry.settingStart ?? entry.settingEnd;
    if (Number.isFinite(settingYear)) return { lane: MODE_SETTING, year: settingYear };

    return null;
  }

  function startEdit(entryId, event, options = {}) {
    if (popupCloseTimerRef.current) {
      window.clearTimeout(popupCloseTimerRef.current);
      popupCloseTimerRef.current = null;
    }

    const entry = entriesRef.current.find((item) => item.id === entryId);
    const derivedTarget = entry ? getEntryFocusTarget(entry, options.lane) : null;
    const nextAnchor = {
      entryId,
      lane: options.lane ?? derivedTarget?.lane ?? (mode === MODE_SETTING ? MODE_SETTING : MODE_PRODUCTION),
      year: Number.isFinite(options.anchorYear) ? options.anchorYear : derivedTarget?.year ?? null
    };

    const origin = options.origin || getEventOrigin(event);
    if (origin) {
      setPopupOrigin(origin);
    }

    setPopupAnchor(nextAnchor);
    setPopupClosing(false);
    setSelectedEntryId(entryId);
    setEditMode(false);
  }

  function onNodeActivate(target, event) {
    const { entryId, lane, anchorYear, resolution, rangeStart, rangeEnd } = target;
    const isOpen = selectedEntryIdRef.current === entryId && !popupClosingRef.current;
    const entry = entriesRef.current.find((item) => item.id === entryId);

    if (isOpen) {
      const origin = getEventOrigin(event);
      if (origin) setPopupOrigin(origin);
      closePopup();
      return;
    } else startEdit(entryId, event, { lane, anchorYear });

    const effectiveResolution = resolution || resolutionFromSpan(pendingZoomSpanRef.current);
    const zoomSpan = nextZoomSpanForResolution(effectiveResolution);
    if (zoomSpan && Number.isFinite(anchorYear)) {
      // Save current zoom state so we can restore it on close
      if (!preZoomStateRef.current) {
        const snapshot = {
          span: pendingZoomSpanRef.current,
          viewStart: pendingViewStartRef.current
        };
        preZoomStateRef.current = snapshot;
        setPreZoomState(snapshot);
      }

      // In BOTH mode, center the midpoint of the production<->setting pair (diagonal link center).
      if (mode === MODE_BOTH && entry) {
        const productionYear = getEntryLaneYear(entry, MODE_PRODUCTION);
        const settingYear = getEntryLaneYear(entry, MODE_SETTING);
        if (Number.isFinite(productionYear) && Number.isFinite(settingYear)) {
          animateTimelineToYear((productionYear + settingYear) / 2, zoomSpan);
          return;
        }
      }

      // If the node has a year span, center on the full span
      if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeEnd > rangeStart) {
        const rangeMid = (rangeStart + rangeEnd) / 2;
        const rangeSpan = (rangeEnd - rangeStart) * 1.6;
        animateTimelineToYear(rangeMid, Math.max(zoomSpan, rangeSpan));
      } else {
        animateTimelineToYear(anchorYear, zoomSpan);
      }
    }
  }

  function onRangeLineActivate(rangeLine, event) {
    if (!canvasRef.current) return;
    const canvasBox = canvasRef.current.getBoundingClientRect();
    const pointerX = clamp(event.clientX - canvasBox.left, 0, canvasBox.width);
    const pointerYear = viewStart + (pointerX / Math.max(1, canvasRect.width)) * timelineState.span;
    const anchorYear = clamp(pointerYear, rangeLine.marker.rangeStart, rangeLine.marker.rangeEnd);

    onNodeActivate(
      {
        entryId: rangeLine.marker.entryId,
        lane: rangeLine.marker.lane,
        anchorYear,
        resolution: rangeLine.resolution
      },
      event
    );
  }

  function onClusterSingleClick(cluster) {
    if (selectedEntryIdRef.current) {
      closePopupImmediate();
    }
    onClusterClick(cluster);
  }

  function onGridEntryClick(entry, event) {
    const lane = gridCluster?.lane ?? (mode === MODE_SETTING ? MODE_SETTING : MODE_PRODUCTION);
    const targetYear =
      lane === MODE_SETTING
        ? entry.settingStart ?? entry.settingEnd ?? entry.productionStart ?? entry.productionEnd
        : entry.productionStart ?? entry.productionEnd ?? entry.settingStart ?? entry.settingEnd;

    startEdit(entry.id, event, { lane, anchorYear: targetYear });

    if (Number.isFinite(targetYear)) {
      const zoomSpan = nextZoomSpanForResolution(resolutionFromSpan(pendingZoomSpanRef.current));
      if (!preZoomStateRef.current) {
        const snapshot = {
          span: pendingZoomSpanRef.current,
          viewStart: pendingViewStartRef.current
        };
        preZoomStateRef.current = snapshot;
        setPreZoomState(snapshot);
      }
      animateTimelineToYear(targetYear, zoomSpan ?? pendingZoomSpanRef.current);
    }
  }

  function onTocItemClick(entry) {
    const target = getEntryFocusTarget(entry);
    setShowToc(false);
    if (Number.isFinite(target?.year)) {
      animateTimelineToYear(target.year, Math.min(timelineState.span, 80), () => {
        setSelectedEntryId(entry.id);
        setPopupAnchor({ lane: target.lane, year: target.year });
        setEditMode(false);
      });
    } else {
      setSelectedEntryId(entry.id);
      setPopupAnchor({ lane: target?.lane, year: target?.year });
      setEditMode(false);
    }
  }

  function toggleType(typeId) {
    // Solo mode: click to solo a type, click again to show all
    setSoloType((current) => (current === typeId ? null : typeId));
  }

  function saveEdit() {
    if (!selectedEntryId || !editDraft) return;

    const existing = entriesRef.current.find((entry) => entry.id === selectedEntryId);
    const settingStart = toYear(editDraft.settingStart);
    const settingEnd = toYear(editDraft.settingEnd) ?? settingStart;

    const nextSettingStart = Number.isFinite(settingStart) ? settingStart : null;
    const nextSettingEnd = Number.isFinite(settingEnd) ? settingEnd : nextSettingStart;
    const hasAnySetting = Number.isFinite(nextSettingStart) || Number.isFinite(nextSettingEnd);

    const previousSettingStart = Number.isFinite(existing?.settingStart) ? existing.settingStart : null;
    const previousSettingEnd = Number.isFinite(existing?.settingEnd) ? existing.settingEnd : previousSettingStart;
    const settingChanged = previousSettingStart !== nextSettingStart || previousSettingEnd !== nextSettingEnd;

    const keepPreviousAutoMeta = Boolean(existing && !settingChanged && existing.settingAuto && !existing.settingUserLocked);
    const manualSetting = hasAnySetting && (settingChanged || !keepPreviousAutoMeta);

    const patch = {
      mediaType: editDraft.mediaType,
      title: String(editDraft.title || "").trim(),
      creator: String(editDraft.creator || "").trim(),
      productionStart: toYear(editDraft.productionStart),
      productionEnd: toYear(editDraft.productionEnd) ?? toYear(editDraft.productionStart),
      settingStart: nextSettingStart,
      settingEnd: nextSettingEnd,
      settingSource: keepPreviousAutoMeta ? existing.settingSource : manualSetting ? "manual" : null,
      settingConfidence: keepPreviousAutoMeta ? existing.settingConfidence : null,
      settingAuto: keepPreviousAutoMeta,
      settingUserLocked: manualSetting,
      inferenceStatus: manualSetting || keepPreviousAutoMeta ? "done" : "idle"
    };

    if (!patch.title) return;

    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== selectedEntryId) return entry;
        return {
          ...entry,
          ...patch
        };
      })
    );

    if (!manualSetting && !keepPreviousAutoMeta) {
      window.setTimeout(() => enqueueInference([selectedEntryId]), 50);
    }

    setEditMode(false);

    setBurstMap((current) => ({ ...current, [selectedEntryId]: "zip" }));
    window.setTimeout(() => {
      setBurstMap((current) => {
        const next = { ...current };
        delete next[selectedEntryId];
        return next;
      });
    }, 560);
  }

  function deleteEntry(entryId) {
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    setSelectedEntryId((current) => (current === entryId ? null : current));
  }

  async function handleImport() {
    if (!importFile) {
      setImportState({ phase: "error", message: "Choose a file first." });
      return;
    }

    setImportState({ phase: "analyzing", message: "Analyzing import file..." });

    let imported = [];

    try {
      if (source === "goodreads") {
        const text = await importFile.text();
        imported = fromGoodreadsCsv(text);
      } else {
        const buffer = await importFile.arrayBuffer();
        imported = await fromLetterboxdZip(buffer);
      }
    } catch {
      setImportState({ phase: "error", message: "Could not parse file." });
      return;
    }

    imported = imported
      .map((entry) => ({
        ...entry,
        id: toEntryId(source === "goodreads" ? "gr" : "lb"),
        productionStart: Number.isFinite(entry.productionStart) ? Math.min(entry.productionStart, Math.floor(presentYear)) : null,
        productionEnd: Number.isFinite(entry.productionEnd) ? Math.min(entry.productionEnd, Math.floor(presentYear)) : entry.productionStart,
        settingStart: Number.isFinite(entry.settingStart) ? Math.min(entry.settingStart, Math.floor(presentYear)) : null,
        settingEnd: Number.isFinite(entry.settingEnd) ? Math.min(entry.settingEnd, Math.floor(presentYear)) : entry.settingStart
      }))
      .filter(
        (entry) =>
          entry.title &&
          (Number.isFinite(entry.productionStart) ||
            Number.isFinite(entry.productionEnd) ||
            Number.isFinite(entry.settingStart) ||
            Number.isFinite(entry.settingEnd))
      );

    if (imported.length === 0) {
      setImportState({ phase: "error", message: "No valid items in this file." });
      return;
    }

    // Ensure newly imported items are visible instead of hidden by prior filters/lane selection.
    setQuery("");
    setSoloType(null);
    if (mode === MODE_SETTING) setMode(MODE_PRODUCTION);

    setImportState({ phase: "deploying", message: `Deploying ${imported.length} nodes...` });

    const importedIds = imported.map((entry) => entry.id);

    imported.forEach((entry, index) => {
      window.setTimeout(() => {
        addEntry(entry, "import");

        if (index === imported.length - 1) {
          setImportState({
            phase: "done",
            message: `Imported ${imported.length} items. SETTING inference running in background...`
          });
          enqueueInference(importedIds);
          setImportFile(null);
        }
      }, index * 10);
    });
  }

  function onClusterClick(cluster) {
    if (mode === MODE_BOTH || cluster.size > 24) {
      setGridClusterId((current) => (current === cluster.id ? null : cluster.id));
      setExpandedClusterId(null);
      setExpandedBranchType(null);
      return;
    }

    setExpandedClusterId((current) => {
      const next = current === cluster.id ? null : cluster.id;
      if (next !== current) setExpandedBranchType(null);
      return next;
    });
    setGridClusterId(null);
  }

  function closeAddPanel() {
    setShowAdd(false);
  }

  function closeSettingsPanel() {
    setShowSettings(false);
  }

  function closeTocPanel() {
    setShowToc(false);
  }

  function closeClusterGrid() {
    setGridClusterId(null);
  }

  function toggleMainMenu(menu) {
    const isOpen = menu === "toc" ? showToc : menu === "add" ? showAdd : showSettings;
    const next = !isOpen;

    setShowToc(next && menu === "toc");
    setShowAdd(next && menu === "add");
    setShowSettings(next && menu === "settings");
  }

  return (
    <div className="timeline-app" data-theme={darkMode ? "dark" : "light"}>
      <div className="corner-buttons top-left">
        <button className="glass-btn" type="button" onClick={() => toggleMainMenu("add")} title="Add media">
          +
        </button>
      </div>

      <div className="corner-buttons top-right">
        <button
          className={`glass-btn view-toggle-btn ${viewMode === "scatter" ? "active" : ""}`}
          type="button"
          onClick={() => setViewMode(v => v === "timeline" ? "scatter" : "timeline")}
          title={viewMode === "timeline" ? "Scatter view" : "Timeline view"}
        >
          {viewMode === "timeline" ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="7" r="1.5"/><circle cx="19" cy="15" r="1.5"/>
              <line x1="6.5" y1="11" x2="10.5" y2="8"/><line x1="13.5" y1="8" x2="17.5" y2="14"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="20" x2="20" y2="20"/><line x1="4" y1="4" x2="4" y2="20"/>
              <polyline points="4,12 9,7 14,10 20,5"/>
            </svg>
          )}
        </button>
        <button className="glass-btn toc-icon" type="button" onClick={() => toggleMainMenu("toc")} title="Table of contents">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M8 9h16M8 16h16M8 23h16" />
            <circle cx="5" cy="9" r="1.2" />
            <circle cx="5" cy="16" r="1.2" />
            <circle cx="5" cy="23" r="1.2" />
          </svg>
        </button>
      </div>

      <div className="corner-buttons bottom-left">
        <button
          className={`glass-btn ${showLegend ? "active" : ""}`}
          type="button"
          onClick={() => setShowLegend(v => !v)}
          title="Media filter legend"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        </button>
        <button className="glass-btn settings-icon" type="button" onClick={() => toggleMainMenu("settings")} title="Settings">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M5 9h7m3 0h12M5 16h12m3 0h7M5 23h7m3 0h12" />
            <circle cx="13" cy="9" r="2.8" />
            <circle cx="17" cy="16" r="2.8" />
            <circle cx="13" cy="23" r="2.8" />
          </svg>
        </button>
        <button
          className="glass-btn"
          type="button"
          onClick={() => setDarkMode(v => !v)}
          title={darkMode ? "Light mode" : "Dark mode"}
        >
          {darkMode ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
      </div>

      <div className="corner-buttons bottom-right">
        <button className="glass-btn" type="button" onClick={resetCompass} title="Compass reset">
          ⊕
        </button>
      </div>

      <div className="top-center-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title, creator, or year…"
        />
      </div>
      {hoveredHeadline ? <div className="hover-headline">{hoveredHeadline}</div> : null}

      {/* TOC panel with decade grouping */}
      {showToc ? (
        <div className="panel-overlay menu-toc" onPointerDown={closeTocPanel}>
          <aside className="toc-panel" onPointerDown={(event) => event.stopPropagation()}>
            <div className="panel-head-row">
              <h2>Contents</h2>
              <button className="close-x-btn" type="button" onClick={closeTocPanel} aria-label="Close">×</button>
            </div>
            <div className="toc-type-filter">
              {MEDIA_TYPES.map(type => (
                <button
                  key={type.id}
                  type="button"
                  className={`toc-type-icon-btn ${tocTypeFilter === type.id ? "active" : ""}`}
                  onClick={() => setTocTypeFilter(t => t === type.id ? null : type.id)}
                  title={type.label}
                >
                  {MEDIA_ICON_PATHS[type.id] ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={MEDIA_ICON_PATHS[type.id]} />
                    </svg>
                  ) : type.icon}
                </button>
              ))}
              {tocTypeFilter !== null ? (
                <button type="button" className="toc-type-clear-btn" onClick={() => setTocTypeFilter(null)} title="Show all types">
                  ×
                </button>
              ) : null}
            </div>
            <div className="toc-mode-filter">
              {[MODE_PRODUCTION, MODE_SETTING].map(m => (
                <button
                  key={m}
                  className={tocFilter === m ? "active" : ""}
                  type="button"
                  onClick={() => setTocFilter(m)}
                >
                  {m === MODE_SETTING ? "Setting" : "Production"}
                </button>
              ))}
            </div>
            <div className="toc-list">
              {(() => {
                // Group by decade based on tocFilter
                const getYear = (entry) => {
                  if (tocFilter === MODE_SETTING) return entry.settingStart ?? entry.productionStart;
                  if (tocFilter === MODE_PRODUCTION) return entry.productionStart ?? entry.settingStart;
                  return entry.settingStart ?? entry.productionStart;
                };
                const grouped = new Map();
                for (const entry of tocEntries) {
                  if (tocTypeFilter !== null && entry.mediaType !== tocTypeFilter) continue;
                  const year = getYear(entry);
                  const decade = Number.isFinite(year) ? Math.floor(year / 10) * 10 : null;
                  const key = decade !== null ? `${decade}s` : "Unknown";
                  if (!grouped.has(key)) grouped.set(key, { label: key, decade, entries: [] });
                  grouped.get(key).entries.push(entry);
                }
                const groups = Array.from(grouped.values()).sort((a, b) => {
                  if (a.decade === null) return 1;
                  if (b.decade === null) return -1;
                  return b.decade - a.decade;
                });
                return groups.map(group => (
                  <div key={group.label} className="toc-decade-group">
                    <div className="toc-decade-label">{group.label}</div>
                    {group.entries.map(entry => (
                      <button key={entry.id} type="button" className="toc-item" onClick={() => onTocItemClick(entry)}>
                        <span className="toc-title">{entry.title}</span>
                        <small>{getType(entry.mediaType).label} · {entry.productionStart ?? "?"}{entry.settingStart && entry.settingStart !== entry.productionStart ? ` · set ${entry.settingStart}` : ""}</small>
                      </button>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </aside>
        </div>
      ) : null}

      {showAdd ? (
        <div className="panel-overlay menu-add" onPointerDown={closeAddPanel}>
          <aside className="sheet add-sheet" onPointerDown={(event) => event.stopPropagation()}>
            <div className="panel-head-row">
              <h2>Add Media</h2>
              <button className="close-x-btn" type="button" onClick={closeAddPanel} aria-label="Close add media">
                ×
              </button>
            </div>
            <p className="hint">SETTING = about the era, PRODUCTION = of the era.</p>
            <form onSubmit={handleAddSubmit}>
            <label>
              Media type
              <select value={addDraft.mediaType} onChange={(event) => setAddField("mediaType", event.target.value)}>
                {MEDIA_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <div className="title-search-wrap">
                <input
                  value={addDraft.title}
                  onChange={(event) => onAddTitleChange(event.target.value)}
                  placeholder="Search title…"
                  autoComplete="off"
                  required
                />
                {titleSearchLoading ? <span className="title-search-spinner">…</span> : null}
                {titleSuggestions.length > 0 ? (
                  <div className="title-suggestions">
                    {titleSuggestions.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className="title-suggestion-item"
                        onClick={() => onSelectTitleSuggestion(s)}
                      >
                        <span className="suggestion-label">{s.label}</span>
                        {s.description ? <span className="suggestion-desc">{s.description}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
            <label>
              Author / Creator
              <input value={addDraft.creator} onChange={(event) => setAddField("creator", event.target.value)} />
            </label>
            <div className="year-fields">
              <div className="year-field-row">
                <label>
                  Production year
                  <input
                    value={addDraft.productionStart}
                    onChange={(event) => setAddField("productionStart", event.target.value)}
                    inputMode="numeric"
                    placeholder="2019"
                  />
                </label>
                <button type="button" className="expand-range-btn" title="Add end year" onClick={() => setAddShowProdEnd(v => !v)} aria-label="Toggle production end year">
                  {addShowProdEnd ? "−" : "→"}
                </button>
                {addShowProdEnd ? (
                  <label>
                    End
                    <input
                      value={addDraft.productionEnd}
                      onChange={(event) => setAddField("productionEnd", event.target.value)}
                      inputMode="numeric"
                      placeholder="2020"
                    />
                  </label>
                ) : null}
              </div>
              <div className="year-field-row">
                <label>
                  Setting year
                  <input
                    value={addDraft.settingStart}
                    onChange={(event) => setAddField("settingStart", event.target.value)}
                    inputMode="numeric"
                    placeholder="1940s"
                  />
                </label>
                <button type="button" className="expand-range-btn" title="Add end year" onClick={() => setAddShowSetEnd(v => !v)} aria-label="Toggle setting end year">
                  {addShowSetEnd ? "−" : "→"}
                </button>
                {addShowSetEnd ? (
                  <label>
                    End
                    <input
                      value={addDraft.settingEnd}
                      onChange={(event) => setAddField("settingEnd", event.target.value)}
                      inputMode="numeric"
                      placeholder="1945"
                    />
                  </label>
                ) : null}
              </div>
            </div>
            <label>
              Notes
              <textarea
                value={addDraft.notes}
                onChange={(event) => setAddField("notes", event.target.value)}
                placeholder="Any notes…"
                rows={2}
                className="notes-input"
              />
            </label>
            <label>
              Tags
              <input
                value={addDraft.tags}
                onChange={(event) => setAddField("tags", event.target.value)}
                placeholder="war, fiction, classic"
                className="tags-input"
              />
            </label>
            <button ref={addButtonRef} type="submit" className="primary-btn">
              Add Entry
            </button>
            </form>

            <div className="import-divider"><span>or import</span></div>
            <div className="import-box">
              <label>
                Source
                <select value={source} onChange={(event) => setSource(event.target.value)}>
                  <option value="goodreads">Goodreads (CSV)</option>
                  <option value="letterboxd">Letterboxd (ZIP)</option>
                </select>
              </label>
              <label>
                File
                <input
                  type="file"
                  accept={source === "goodreads" ? ".csv,text/csv" : ".zip,application/zip"}
                  onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                />
              </label>
              <button className="primary-btn" type="button" onClick={handleImport}>
                Import
              </button>
              {importState.phase !== "idle" ? <p className="import-status">{importState.message}</p> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {showSettings ? (
        <div className="panel-overlay menu-settings" onPointerDown={closeSettingsPanel}>
          <aside className="sheet settings-sheet" onPointerDown={(event) => event.stopPropagation()}>
            <div className="panel-head-row">
              <h2>Settings</h2>
              <button className="close-x-btn" type="button" onClick={closeSettingsPanel} aria-label="Close settings">
                ×
              </button>
            </div>
            <div className="mode-row">
            <button className={mode === MODE_SETTING ? "active" : ""} type="button" onClick={() => {
              setMode(MODE_SETTING);
              const c = findDensestYear(filteredEntries, MODE_SETTING);
              if (c != null) animateTimelineToYear(c, Math.min(timelineState.span, 100));
            }}>
              SETTING
            </button>
            <button className={mode === MODE_PRODUCTION ? "active" : ""} type="button" onClick={() => {
              setMode(MODE_PRODUCTION);
              const c = findDensestYear(filteredEntries, MODE_PRODUCTION);
              if (c != null) animateTimelineToYear(c, Math.min(timelineState.span, 100));
            }}>
              PRODUCTION
            </button>
            <button className={mode === MODE_BOTH ? "active" : ""} type="button" onClick={() => {
              setMode(MODE_BOTH);
              const c = findDensestYear(filteredEntries, MODE_PRODUCTION);
              if (c != null) animateTimelineToYear(c, Math.min(timelineState.span, 100));
            }}>
              BOTH
            </button>
          </div>

          <h3>Media Filters</h3>
          <div className="type-grid">
            {MEDIA_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className={soloType === type.id ? "type-chip active" : "type-chip"}
                onClick={() => toggleType(type.id)}
              >
                <span>{type.icon}</span>
                {type.label}
              </button>
            ))}
          </div>

          <h3>Display Options</h3>
          <div className="settings-toggle-row">
            <span>Show month precision on tick labels</span>
            <button
              type="button"
              className={showMonthResolution ? "toggle-btn active" : "toggle-btn"}
              onClick={() => setShowMonthResolution(v => !v)}
            >
              {showMonthResolution ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-toggle-row">
            <span>Show historical era zones</span>
            <button
              type="button"
              className={showEras ? "toggle-btn active" : "toggle-btn"}
              onClick={() => setShowEras(v => !v)}
            >
              {showEras ? "On" : "Off"}
            </button>
          </div>

          </aside>
        </div>
      ) : null}

      {selectedEntry && editDraft ? (
        <div className="node-popup-overlay" onPointerDown={closePopup}>
          {popupGeometry ? (
            <svg className="popup-callout-layer" aria-hidden="true">
              <line x1={popupGeometry.calloutStartX} y1={popupGeometry.calloutStartY} x2={popupGeometry.calloutEndX} y2={popupGeometry.calloutEndY} />
            </svg>
          ) : null}
          <aside
            ref={popupRef}
            className={popupClosing ? "node-popup closing" : "node-popup"}
            style={{
              left: `${popupGeometry?.left ?? Math.max(14, window.innerWidth / 2 - popupSize.width / 2)}px`,
              top: `${popupGeometry?.top ?? 14}px`,
              "--from-x": `${popupOrigin.x - ((popupGeometry?.left ?? window.innerWidth / 2 - popupSize.width / 2) + popupSize.width / 2)}px`,
              "--from-y": `${popupOrigin.y - ((popupGeometry?.top ?? 14) + popupSize.height / 2)}px`
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="detail-header">
              <h2>{editDraft.title || "Untitled"}</h2>
              <div className="popup-head-actions">
                <button type="button" className={editMode ? "active" : ""} onClick={() => setEditMode((value) => !value)}>
                  ✎
                </button>
                <button className="close-x-btn" type="button" onClick={closePopupImmediate} aria-label="Close node details">
                  ×
                </button>
              </div>
            </div>

            {editMode ? (
              <form
                className="detail-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveEdit();
                }}
              >
                <label>
                  Name
                  <input value={editDraft.title} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} required />
                </label>
                <label>
                  Author / Creator
                  <input value={editDraft.creator} onChange={(event) => setEditDraft((current) => ({ ...current, creator: event.target.value }))} />
                </label>
                <label>
                  Type
                  <select
                    value={editDraft.mediaType}
                    onChange={(event) => setEditDraft((current) => ({ ...current, mediaType: event.target.value }))}
                  >
                    {MEDIA_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="year-grid compact">
                  <label>
                    PRODUCTION start
                    <input
                      value={editDraft.productionStart}
                      onChange={(event) => setEditDraft((current) => ({ ...current, productionStart: event.target.value }))}
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    PRODUCTION end
                    <input
                      value={editDraft.productionEnd}
                      onChange={(event) => setEditDraft((current) => ({ ...current, productionEnd: event.target.value }))}
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    SETTING start
                    <input
                      value={editDraft.settingStart}
                      onChange={(event) => setEditDraft((current) => ({ ...current, settingStart: event.target.value }))}
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    SETTING end
                    <input
                      value={editDraft.settingEnd}
                      onChange={(event) => setEditDraft((current) => ({ ...current, settingEnd: event.target.value }))}
                      inputMode="numeric"
                    />
                  </label>
                </div>

                <label>
                  Notes
                  <textarea
                    value={editDraft.notes ?? ""}
                    onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Any notes…"
                    rows={2}
                    className="notes-input"
                  />
                </label>
                <label>
                  Tags
                  <input
                    value={Array.isArray(editDraft.tags) ? editDraft.tags.join(", ") : ""}
                    onChange={(event) => setEditDraft((current) => ({ ...current, tags: event.target.value.split(",").map(t => t.trim()).filter(Boolean) }))}
                    placeholder="war, fiction, classic"
                    className="tags-input"
                  />
                </label>

                <div className="detail-actions">
                  <button type="submit" className="primary-btn">
                    Save
                  </button>
                  <button type="button" onClick={() => deleteEntry(selectedEntry.id)}>
                    Delete
                  </button>
                  <button type="button" onClick={closePopup}>
                    Close
                  </button>
                </div>
              </form>
            ) : (
              <div className="detail-readonly">
                <p><strong>Type:</strong> {getType(selectedEntry.mediaType).label}</p>
                <p><strong>Creator:</strong> {selectedEntry.creator || "—"}</p>
                <p><strong>PRODUCTION:</strong> {selectedEntry.productionStart ?? "—"} {selectedEntry.productionEnd && selectedEntry.productionEnd !== selectedEntry.productionStart ? `→ ${selectedEntry.productionEnd}` : ""}</p>
                <p><strong>SETTING:</strong> {selectedEntry.settingStart ?? "—"} {selectedEntry.settingEnd && selectedEntry.settingEnd !== selectedEntry.settingStart ? `→ ${selectedEntry.settingEnd}` : ""}</p>

                {/* Inline notes */}
                <div className="inline-notes-section">
                  <button
                    className={`inline-notes-trigger ${selectedEntry.notes ? "has-content" : ""}`}
                    onClick={() => { setInlineNotesOpen(true); setInlineNotesDraft(selectedEntry.notes || ""); }}
                  >
                    {selectedEntry.notes ? "Notes" : "+ Notes"}
                  </button>
                  {selectedEntry.notes && !inlineNotesOpen ? (
                    <p className="inline-notes-text">{selectedEntry.notes}</p>
                  ) : null}
                  {inlineNotesOpen ? (
                    <div className="inline-notes-edit">
                      <textarea
                        autoFocus
                        value={inlineNotesDraft}
                        onChange={e => setInlineNotesDraft(e.target.value)}
                        placeholder="Add notes…"
                      />
                      <div className="inline-notes-save-row">
                        <button onClick={() => setInlineNotesOpen(false)}>Cancel</button>
                        <button className="save-btn" onClick={() => {
                          setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, notes: inlineNotesDraft.trim() } : en));
                          setInlineNotesOpen(false);
                        }}>Save</button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Inline tags */}
                <div className="inline-tags-section">
                  {(selectedEntry.tags || []).map(tag => (
                    <span key={tag} className="tag-pill">
                      #{tag}
                      <button className="tag-pill-remove" onClick={() => {
                        setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, tags: en.tags.filter(t => t !== tag) } : en));
                      }}>×</button>
                    </span>
                  ))}
                  {addingTag ? (
                    <input
                      autoFocus
                      className="tag-add-input"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && tagInput.trim()) {
                          const newTag = tagInput.trim().replace(/^#/, "");
                          setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, tags: [...(en.tags||[]), newTag] } : en));
                          setTagInput("");
                          setAddingTag(false);
                        }
                        if (e.key === "Escape") { setAddingTag(false); setTagInput(""); }
                      }}
                      onBlur={() => { setAddingTag(false); setTagInput(""); }}
                      placeholder="#tag"
                    />
                  ) : (
                    <button className="tag-add-btn" onClick={() => setAddingTag(true)}>+ tag</button>
                  )}
                </div>

                {/* Per-entry color picker */}
                <div className="node-color-row">
                  <span className="node-color-label">Color</span>
                  <div className="color-swatch-grid">
                    <button
                      className={`color-swatch is-bw ${!selectedEntry.color ? "selected" : ""}`}
                      title="Default (B&W)"
                      onClick={() => setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, color: null } : en))}
                    />
                    {["#c0392b","#d35400","#f39c12","#27ae60","#2980b9","#8e44ad","#2c3e50","#7f8c8d"].map(c => (
                      <button
                        key={c}
                        className={`color-swatch ${selectedEntry.color === c ? "selected" : ""}`}
                        style={{ background: c }}
                        title={c}
                        onClick={() => setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, color: c } : en))}
                      />
                    ))}
                    <div className="color-swatch-custom" title="Custom color" style={selectedEntry.color && !["#c0392b","#d35400","#f39c12","#27ae60","#2980b9","#8e44ad","#2c3e50","#7f8c8d"].includes(selectedEntry.color) ? { background: selectedEntry.color } : {}}>
                      <span style={{pointerEvents:"none",position:"relative",zIndex:1}}>+</span>
                      <input
                        type="color"
                        value={selectedEntry.color || "#1c1a17"}
                        onChange={e => setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, color: e.target.value } : en))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      <section
        ref={canvasRef}
        className="timeline-canvas"
        onWheel={onWheelNavigate}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <svg width="100%" height="100%" viewBox={`0 0 ${canvasRect.width} ${canvasRect.height}`}>
          <rect x="0" y="0" width={canvasRect.width} height={canvasRect.height} fill="transparent" />

          {/* Era background zones */}
          {showEras && (() => {
            const visibleEras = HISTORICAL_ERAS
              .filter(era => activeEraIds.has(era.id))
              .map(era => {
                const x1 = toX(era.start, viewStart, timelineState.span, canvasRect.width);
                const x2 = toX(era.end, viewStart, timelineState.span, canvasRect.width);
                if (x2 < -60 || x1 > canvasRect.width + 60) return null;
                const rx = Math.max(x1, -60);
                const rw = Math.min(x2, canvasRect.width + 60) - rx;
                if (rw <= 0) return null;
                const midX = clamp((x1 + x2) / 2, 8, canvasRect.width - 8);
                return { era, rx, rw, x1, x2, midX };
              })
              .filter(Boolean);

            // Suppress overlapping labels
            let lastLabelRight = -Infinity;
            const labelAllowed = visibleEras.map(item => {
              const labelLeft = item.midX - 40;
              if (item.rw > 60 && labelLeft > lastLabelRight) {
                lastLabelRight = item.midX + 40;
                return true;
              }
              return false;
            });

            const laneYValues = Object.values(lanes);
            const topY = laneYValues.length > 0 ? Math.min(...laneYValues) - 50 : canvasRect.height / 2 - 80;
            const bottomY = laneYValues.length > 0 ? Math.max(...laneYValues) + 50 : canvasRect.height / 2 + 80;

            return visibleEras.map((item, i) => (
              <g key={item.era.id} className="era-zone">
                <rect
                  x={item.rx} y={topY}
                  width={item.rw} height={bottomY - topY}
                  fill={item.era.color}
                  opacity="0.18"
                  rx="2"
                />
                {labelAllowed[i] ? (
                  <text
                    x={item.midX}
                    y={topY - 8}
                    textAnchor="middle"
                    className="era-label"
                  >
                    {item.era.label}
                  </text>
                ) : null}
              </g>
            ));
          })()}

          {ticks.values.map((value) => {
            const x = toX(value, viewStart, timelineState.span, canvasRect.width);
            if (x < -60 || x > canvasRect.width + 60) return null;

            return (
              <g key={`tick-${value}`} className="tick-group">
                {Object.values(lanes).map((laneY) => (
                  <line key={`${value}-${laneY}`} x1={x} y1={laneY - 22} x2={x} y2={laneY + 22} className="tick-line" />
                ))}
                <text x={x} y={Math.min(...Object.values(lanes)) - 36} textAnchor="middle" className="tick-label">
                  {formatTick(value, ticks.step)}
                </text>
              </g>
            );
          })}

          {Object.entries(lanes).map(([lane, y]) => (
            <line key={lane} x1="0" y1={y} x2={canvasRect.width} y2={y} className="timeline-line" />
          ))}

          {selectedDualLink ? (
            <line
              className="selected-dual-link"
              x1={selectedDualLink.x1}
              y1={selectedDualLink.y1}
              x2={selectedDualLink.x2}
              y2={selectedDualLink.y2}
            />
          ) : null}

          {rangeLines.map((rangeLine) => (
            <g key={`range-${rangeLine.marker.id}`}>
              {(() => {
                const isActive = hoveredRangeMarkerId === rangeLine.marker.id || selectedEntryId === rangeLine.marker.entryId;
                return (
                  <line
                    x1={rangeLine.marker.xStart}
                    y1={rangeLine.marker.lineY}
                    x2={rangeLine.marker.xEnd}
                    y2={rangeLine.marker.lineY}
                    stroke={rangeLine.marker.color || "var(--line)"}
                    strokeWidth={isActive ? "7" : "4"}
                    strokeLinecap="round"
                    opacity={isActive ? "0.98" : "0.86"}
                    style={{ transition: "stroke-width 140ms ease, opacity 140ms ease" }}
                  />
                );
              })()}
              <line
                x1={rangeLine.marker.xStart}
                y1={rangeLine.marker.lineY}
                x2={rangeLine.marker.xEnd}
                y2={rangeLine.marker.lineY}
                stroke="transparent"
                strokeWidth="20"
                strokeLinecap="round"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onMouseEnter={() => setHoveredRangeMarkerId(rangeLine.marker.id)}
                onMouseLeave={() => setHoveredRangeMarkerId((current) => (current === rangeLine.marker.id ? null : current))}
                onClick={(event) => onRangeLineActivate(rangeLine, event)}
              />
            </g>
          ))}


          {(() => {
            const presentX = toX(presentYear, viewStart, timelineState.span, canvasRect.width);
            const futureZoneVisible = presentX < canvasRect.width;
            return (
              <>
                {futureZoneVisible && presentX > 0 ? (
                  <rect
                    x={presentX} y={0}
                    width={Math.max(0, canvasRect.width - presentX)}
                    height={canvasRect.height}
                    fill="rgba(255,255,255,0.025)"
                    pointerEvents="none"
                  />
                ) : null}
                {presentX > 0 && presentX < canvasRect.width ? (
                  <>
                    <line x1={presentX} y1={0} x2={presentX} y2={canvasRect.height} className="present-guard" />
                    <text x={presentX + 5} y={18} className="present-label">Now</text>
                  </>
                ) : null}
              </>
            );
          })()}
        </svg>

        <div className="nodes-layer">
          {entries.length === 0 ? (
            <div className="onboarding-hint">
              <p>Log your first piece of media to begin mapping history.</p>
              <span>Press <strong>+</strong> to add something.</span>
            </div>
          ) : null}
          {visibleRenderItems.map((item) => {
            if (item.type === "cluster") {
              const laneY = lanes[item.lane] ?? canvasRect.height / 2;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="node cluster"
                  style={{ left: `${item.x}px`, top: `${laneY}px`, opacity: selectedEntryId ? 0.25 : 1, transition: "opacity 200ms ease" }}
                  onMouseEnter={() => setHoveredClusterId(item.id)}
                  onMouseLeave={() => setHoveredClusterId((current) => (current === item.id ? null : current))}
                  onClick={() => onClusterSingleClick(item)}
                  title={`${item.size} items`}
                >
                  {item.size}
                </button>
              );
            }

            const marker = item.marker;
            const entry = entryById.get(marker.entryId);
            if (!entry) return null;

            const type = getType(marker.mediaType);
            const isDetailed = timelineState.span <= 72;
            const burst = burstMap[entry.id];

            const classes = ["node"];
            if (burst === "manual") classes.push("burst-manual");
            if (burst === "import") classes.push("burst-import");
            if (burst === "zip") classes.push("burst-zip");
            const isSelected = selectedEntryId === marker.entryId;
            const isFaded = selectedEntryId && !isSelected;

            return (
              <div
                key={marker.id}
                className="node-stack"
                data-lane={marker.lane}
                style={{
                  left: `${marker.xStart}px`,
                  top: `${marker.nodeY}px`,
                  opacity: isFaded ? 0.2 : 1,
                  transition: "opacity 200ms ease",
                  zIndex: isSelected ? 2 : undefined
                }}
              >
                <button
                  type="button"
                  className={classes.join(" ")}
                  style={{ background: marker.color || colorForMediaType(marker.mediaType) }}
                  onMouseEnter={() => {
                    setHoveredEntryId(marker.entryId);
                    if (marker.rangeEnd > marker.rangeStart) setHoveredRangeMarkerId(marker.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredEntryId((current) => (current === marker.entryId ? null : current));
                    setHoveredRangeMarkerId((current) => (current === marker.id ? null : current));
                  }}
                  onClick={(event) =>
                    onNodeActivate(
                      {
                        entryId: marker.entryId,
                        lane: marker.lane,
                        anchorYear: marker.primaryYear,
                        resolution: item.resolution,
                        rangeStart: marker.rangeStart,
                        rangeEnd: marker.rangeEnd
                      },
                      event
                    )
                  }
                  title={entry.title}
                >
                  {MEDIA_ICON_PATHS[marker.mediaType] ? (
                    <svg viewBox="0 0 24 24" width={isDetailed ? 13 : 10} height={isDetailed ? 13 : 10} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={MEDIA_ICON_PATHS[marker.mediaType]} />
                    </svg>
                  ) : type.icon}
                </button>

                {timelineState.span <= 220 && marker.rangeEnd > marker.rangeStart ? (
                  <button
                    type="button"
                    className="node end-cap"
                    style={{
                      left: `${marker.xEnd - marker.xStart}px`,
                      top: "0px",
                      background: marker.color || colorForMediaType(marker.mediaType)
                    }}
                    onMouseEnter={() => {
                      setHoveredEntryId(marker.entryId);
                      setHoveredRangeMarkerId(marker.id);
                    }}
                    onMouseLeave={() => {
                      setHoveredEntryId((current) => (current === marker.entryId ? null : current));
                      setHoveredRangeMarkerId((current) => (current === marker.id ? null : current));
                    }}
                    onClick={(event) =>
                      onNodeActivate(
                        {
                          entryId: marker.entryId,
                          lane: marker.lane,
                          anchorYear: marker.rangeEnd,
                          resolution: item.resolution,
                          rangeStart: marker.rangeStart,
                          rangeEnd: marker.rangeEnd
                        },
                        event
                      )
                    }
                    title={`${entry.title} end`}
                  />
                ) : null}

              </div>
            );
          })}

          {expandedCluster && mode !== MODE_BOTH
            ? (() => {
                const branchLane = expandedCluster.lane;
                const baseY = lanes[branchLane] ?? canvasRect.height / 2;
                const baseX = expandedCluster.x;
                const typeGroups = expandedBranchData.groups;
                const activeGroup = expandedBranchData.activeGroup;
                const activeEntries = expandedBranchData.activeEntries;
                const groupY = branchLane === MODE_PRODUCTION ? baseY - 84 : baseY + 84;
                const detailY = branchLane === MODE_PRODUCTION ? groupY - 70 : groupY + 70;
                const groupSpacing = 46;
                const itemSpacing = 24;
                const activeGroupIndex = activeGroup ? typeGroups.findIndex((group) => group.mediaType === activeGroup.mediaType) : -1;
                const activeGroupX = activeGroupIndex >= 0
                  ? spreadX(baseX, activeGroupIndex, typeGroups.length, groupSpacing)
                  : baseX;

                return (
                  <>
                    {typeGroups.map((group, index) => {
                      const x = spreadX(baseX, index, typeGroups.length, groupSpacing);
                      const isActiveType = expandedBranchType === group.mediaType;
                      return (
                        <button
                          key={`branch-type-${expandedCluster.id}-${group.mediaType}`}
                          type="button"
                          className={`node branch-node type-group-node${isActiveType ? " active" : ""}`}
                          style={{ left: `${x}px`, top: `${groupY}px`, background: colorForMediaType(group.mediaType) }}
                          onClick={() => setExpandedBranchType((current) => (current === group.mediaType ? null : group.mediaType))}
                          title={`${group.label}: ${group.count}`}
                        >
                          {group.count}
                        </button>
                      );
                    })}

                    {activeEntries.map((item, index) => {
                      const entry = item.entry;
                      const x = spreadX(activeGroupX, index, activeEntries.length, itemSpacing);
                      return (
                        <button
                          key={`branch-entry-${entry.id}`}
                          type="button"
                          className="node branch-node branch-item-node"
                          style={{ left: `${x}px`, top: `${detailY}px`, background: entry.color || colorForMediaType(entry.mediaType) }}
                          onMouseEnter={() => setHoveredEntryId(entry.id)}
                          onMouseLeave={() => setHoveredEntryId((current) => (current === entry.id ? null : current))}
                          onClick={(event) =>
                            onNodeActivate(
                              {
                                entryId: entry.id,
                                lane: branchLane,
                                anchorYear: item.year,
                                resolution: "year"
                              },
                              event
                            )
                          }
                          title={entry.title}
                        />
                      );
                    })}
                  </>
                );
              })()
            : null}

          {flight ? (
            <div
              className="flight-node"
              style={{
                left: `${flight.startX}px`,
                top: `${flight.startY}px`,
                "--dx": `${flight.dx}px`,
                "--dy": `${flight.dy}px`,
                background: flight.color
              }}
            />
          ) : null}
        </div>

          {expandedCluster && mode !== MODE_BOTH ? (
          <svg
            className="branch-lines-overlay"
            width="100%"
            height="100%"
            viewBox={`0 0 ${canvasRect.width} ${canvasRect.height}`}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
          >
            {(() => {
              const branchLane = expandedCluster.lane;
              const baseY = lanes[branchLane] ?? canvasRect.height / 2;
              const baseX = expandedCluster.x;
              const typeGroups = expandedBranchData.groups;
              const activeGroup = expandedBranchData.activeGroup;
              const activeEntries = expandedBranchData.activeEntries;
              const groupY = branchLane === MODE_PRODUCTION ? baseY - 84 : baseY + 84;
              const detailY = branchLane === MODE_PRODUCTION ? groupY - 70 : groupY + 70;
              const groupSpacing = 46;
              const itemSpacing = 24;
              const activeGroupIndex = activeGroup ? typeGroups.findIndex((group) => group.mediaType === activeGroup.mediaType) : -1;
              const activeGroupX = activeGroupIndex >= 0
                ? spreadX(baseX, activeGroupIndex, typeGroups.length, groupSpacing)
                : baseX;
              return (
                <>
                  {typeGroups.map((group, index) => {
                    const x = spreadX(baseX, index, typeGroups.length, groupSpacing);
                    return <line key={`branch-type-line-${group.mediaType}`} x1={baseX} y1={baseY} x2={x} y2={groupY} className="branch-line" />;
                  })}
                  {activeEntries.map((item, index) => {
                    const x = spreadX(activeGroupX, index, activeEntries.length, itemSpacing);
                    return <line key={`branch-item-line-${item.entry.id}`} x1={activeGroupX} y1={groupY} x2={x} y2={detailY} className="branch-line" />;
                  })}
                </>
              );
            })()}
          </svg>
        ) : null}
      </section>

      {viewMode === "scatter" && scatterBounds ? (
        <section className="scatter-canvas">
          <svg width="100%" height="100%">
            {(() => {
              const margin = { top: 40, right: 40, bottom: 50, left: 60 };
              const w = canvasRect.width - margin.left - margin.right;
              const h = canvasRect.height - margin.top - margin.bottom;
              const toSX = (year) => margin.left + ((year - scatterBounds.minX) / (scatterBounds.maxX - scatterBounds.minX)) * w;
              const toSY = (year) => margin.top + h - ((year - scatterBounds.minY) / (scatterBounds.maxY - scatterBounds.minY)) * h;
              const diag = Math.min(scatterBounds.maxX, scatterBounds.maxY);
              const diagMin = Math.max(scatterBounds.minX, scatterBounds.minY);

              // X axis tick years
              const xSpan = scatterBounds.maxX - scatterBounds.minX;
              const xStep = xSpan > 400 ? 100 : xSpan > 100 ? 50 : xSpan > 40 ? 10 : 5;
              const xFirstTick = Math.ceil(scatterBounds.minX / xStep) * xStep;
              const xTicks = [];
              for (let t = xFirstTick; t <= scatterBounds.maxX; t += xStep) xTicks.push(t);

              const ySpan = scatterBounds.maxY - scatterBounds.minY;
              const yStep = ySpan > 400 ? 100 : ySpan > 100 ? 50 : ySpan > 40 ? 10 : 5;
              const yFirstTick = Math.ceil(scatterBounds.minY / yStep) * yStep;
              const yTicks = [];
              for (let t = yFirstTick; t <= scatterBounds.maxY; t += yStep) yTicks.push(t);

              return (
                <g>
                  {/* Era bands on Y axis (setting eras) */}
                  {HISTORICAL_ERAS.filter(era => activeEraIds.has(era.id)).map(era => {
                    const y1 = toSY(Math.min(era.end, scatterBounds.maxY));
                    const y2 = toSY(Math.max(era.start, scatterBounds.minY));
                    if (y2 < margin.top || y1 > margin.top + h) return null;
                    const ry = clamp(y1, margin.top, margin.top + h);
                    const rh = clamp(y2, margin.top, margin.top + h) - ry;
                    return (
                      <g key={era.id}>
                        <rect x={margin.left} y={ry} width={w} height={rh} fill={era.color} opacity="0.18" />
                        {rh > 16 ? (
                          <text x={margin.left + 6} y={ry + Math.min(rh / 2, 14) + 4} className="era-label scatter-era-label">
                            {era.label}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                  {/* Diagonal "contemporary" reference line */}
                  {diagMin < diag ? (
                    <line
                      x1={toSX(diagMin)} y1={toSY(diagMin)}
                      x2={toSX(diag)} y2={toSY(diag)}
                      className="scatter-diagonal"
                    />
                  ) : null}
                  {/* Grid lines */}
                  {xTicks.map(t => (
                    <line key={`xg-${t}`} x1={toSX(t)} y1={margin.top} x2={toSX(t)} y2={margin.top + h} className="scatter-grid-line" />
                  ))}
                  {yTicks.map(t => (
                    <line key={`yg-${t}`} x1={margin.left} y1={toSY(t)} x2={margin.left + w} y2={toSY(t)} className="scatter-grid-line" />
                  ))}
                  {/* Axes */}
                  <line x1={margin.left} y1={margin.top + h} x2={margin.left + w} y2={margin.top + h} className="scatter-axis" />
                  <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + h} className="scatter-axis" />
                  {/* Axis labels */}
                  <text x={margin.left + w / 2} y={canvasRect.height - 8} textAnchor="middle" className="scatter-axis-label">Production Year</text>
                  <text x={14} y={margin.top + h / 2} textAnchor="middle" className="scatter-axis-label" transform={`rotate(-90, 14, ${margin.top + h / 2})`}>Setting Year</text>
                  {/* X axis ticks */}
                  {xTicks.map(t => (
                    <g key={`xt-${t}`}>
                      <line x1={toSX(t)} y1={margin.top + h} x2={toSX(t)} y2={margin.top + h + 5} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                      <text x={toSX(t)} y={margin.top + h + 18} textAnchor="middle" className="tick-label">{t}</text>
                    </g>
                  ))}
                  {/* Y axis ticks */}
                  {yTicks.map(t => (
                    <g key={`yt-${t}`}>
                      <line x1={margin.left - 5} y1={toSY(t)} x2={margin.left} y2={toSY(t)} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                      <text x={margin.left - 8} y={toSY(t) + 4} textAnchor="end" className="tick-label">{t}</text>
                    </g>
                  ))}
                  {/* Points */}
                  {scatterPoints.map(({ entry, px, sy }) => {
                    const cx = toSX(px);
                    const cy = toSY(sy);
                    if (cx < margin.left - 10 || cx > margin.left + w + 10) return null;
                    if (cy < margin.top - 10 || cy > margin.top + h + 10) return null;
                    const isSelected = entry.id === selectedEntryId;
                    return (
                      <g key={entry.id} className="scatter-point-group">
                        <circle
                          cx={cx} cy={cy} r={isSelected ? 8 : 6}
                          fill={colorFor(entry.id, MODE_PRODUCTION)}
                          stroke={isSelected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)"}
                          strokeWidth={isSelected ? 2 : 1}
                          className="scatter-point"
                          onClick={(event) => {
                            const target = getEntryFocusTarget(entry, MODE_PRODUCTION);
                            startEdit(entry.id, event, { lane: target?.lane, anchorYear: target?.year });
                          }}
                        />
                        {isSelected ? (
                          <text cx={cx} x={cx + 10} y={cy + 4} className="scatter-point-label">{entry.title}</text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })()}
          </svg>
          <div className="scatter-legend">
            <span>↙ Historical (set earlier than made)</span>
            <span>— Contemporary</span>
            <span>↗ Future (set later than made)</span>
          </div>
        </section>
      ) : null}

      <section className="overview-navigator-wrap">
        <div
          className="overview-resize-grip"
          onPointerDown={onOverviewResizeDown}
          onPointerMove={onOverviewResizeMove}
          onPointerUp={onOverviewResizeUp}
          onPointerCancel={onOverviewResizeUp}
          title="Resize overview"
        />
        <div className="overview-label-row">
          <span>{Math.round(overviewRange.start)}</span>
          <span>{Math.round(presentYear)} (present)</span>
        </div>
        <div ref={overviewRef} className="overview-track" style={{ height: `${overviewHeight}px` }} onClick={onOverviewClick} onWheel={onOverviewWheel}>
          <div className="overview-baseline" />
          {overviewMiniPoints.map((point) => (
            <div
              key={point.id}
              className={`overview-mini-dot ${point.lane === MODE_PRODUCTION ? "prod" : "set"}`}
              style={{ left: `${point.x}px`, background: point.color }}
            />
          ))}
          <div
            className="overview-handle"
            style={{ left: `${overviewHandle.left}px`, width: `${overviewHandle.width}px` }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={onOverviewRectDown}
            onPointerMove={onOverviewRectMove}
            onPointerUp={onOverviewRectUp}
            onPointerCancel={onOverviewRectUp}
            aria-label="Visible range"
          >
            <div
              className="overview-handle-edge left"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => onOverviewEdgeDown("left", event)}
              onPointerMove={onOverviewEdgeMove}
              onPointerUp={onOverviewEdgeUp}
              onPointerCancel={onOverviewEdgeUp}
              aria-label="Resize visible range start"
              role="button"
            />
            <div
              className="overview-handle-edge right"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => onOverviewEdgeDown("right", event)}
              onPointerMove={onOverviewEdgeMove}
              onPointerUp={onOverviewEdgeUp}
              onPointerCancel={onOverviewEdgeUp}
              aria-label="Resize visible range end"
              role="button"
            />
          </div>
        </div>
      </section>

      {gridCluster ? (
        <div className="panel-overlay" onPointerDown={closeClusterGrid}>
          <section className="cluster-grid-sheet" onPointerDown={(event) => event.stopPropagation()}>
            <div className="cluster-grid-header">
              <h2>{gridEntries.length} items in cluster</h2>
              <button className="close-x-btn" type="button" onClick={closeClusterGrid} aria-label="Close cluster view">
                ×
              </button>
            </div>

            <div className="cluster-grid">
              {gridEntries.map((entry) => (
                <button key={entry.id} type="button" className="cluster-card" onClick={(event) => onGridEntryClick(entry, event)}>
                  <span>{entry.title}</span>
                  <small>
                    P: {entry.productionStart ?? "?"} | S: {entry.settingStart ?? "?"}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <div className="status-bar">
        <span>{filteredEntries.length} items · {visibleEntryCount} visible · {baseRenderedUnits} nodes</span>
        {(inferenceUi.queued > 0 || inferenceUi.running > 0) ? (
          <span>Inferring: {inferenceUi.running} active, {inferenceUi.queued} queued</span>
        ) : null}
      </div>

      {showLegend ? (
        <div className="legend-panel">
          <h3>Mode</h3>
          <div className="legend-mode-row">
            {[MODE_SETTING, MODE_PRODUCTION, MODE_BOTH].map(m => (
              <button
                key={m}
                className={`legend-mode-btn ${mode === m ? "active" : ""}`}
                onClick={() => {
                  setMode(m);
                  const center = findDensestYear(filteredEntries, m);
                  if (center != null) animateTimelineToYear(center, Math.min(timelineState.span, 100));
                }}
              >
                {m === MODE_SETTING ? "SET" : m === MODE_PRODUCTION ? "PROD" : "BOTH"}
              </button>
            ))}
          </div>
          <div className="legend-divider" />
          <h3>Media type</h3>
          {MEDIA_TYPES.map(type => (
            <div
              key={type.id}
              className={`legend-type-row ${soloType === type.id ? "solo-active" : ""}`}
              onClick={() => toggleType(type.id)}
            >
              <div className="legend-type-icon">{type.icon}</div>
              <span className="legend-type-label">{type.label}</span>
              {soloType === type.id ? <span style={{marginLeft:"auto",fontSize:"0.6rem",opacity:0.7}}>only</span> : null}
            </div>
          ))}
          {soloType !== null ? (
            <button
              style={{width:"100%",marginTop:6,fontSize:"0.7rem",padding:"4px",border:"1px solid var(--stroke-med)",borderRadius:5,background:"transparent",color:"var(--muted)",cursor:"pointer"}}
              onClick={() => setSoloType(null)}
            >
              Show all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default App;
