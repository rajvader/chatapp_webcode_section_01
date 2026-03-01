// This file has been renamed to dataTools.js. Please update your imports accordingly.
export * from './dataTools';

// ── Parse a CSV line, respecting quoted fields ────────────────────────────────

const parseLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

// ── Parse a full CSV text into an array of row objects ────────────────────────

export const parseCsvToRows = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] || '').replace(/^"|"$/g, '');
    });
    return obj;
  });
  return { headers, rows };
};

// ── Column lookup (case-insensitive + whitespace-tolerant) ───────────────────
// Gemini often passes column names in a slightly different case than the CSV header.
// This finds the actual header key so the lookup always works.

const resolveCol = (rows, name) => {
  if (!rows.length || !name) return name;
  const keys = Object.keys(rows[0]);
  // 1. exact match
  if (keys.includes(name)) return name;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(name);
  // 2. normalised match
  return keys.find((k) => norm(k) === target) || name;
};

// ── Math helpers ──────────────────────────────────────────────────────────────

const numericValues = (rows, col) =>
  rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(4);

// ── Build a slim CSV with only the key analytical columns ────────────────────
// Extracts text, language, type, engagement metrics, and the computed engagement
// ratio. Returns a plain CSV string Gemini can read directly in its context —
// no base64 or Python needed. ~6-10k tokens for a 250-row tweet dataset.

const SLIM_PATTERNS = [
  /^text$/i,
  /^language$/i,
  /^type$/i,
  /^view.?count$/i,
  /^reply.?count$/i,
  /^retweet.?count$/i,
  /^quote.?count$/i,
  /^favorite.?count$/i,
  /^(created.?at|timestamp|date)$/i,
  /^engagement$/i,            // computed column added by enrichWithEngagement
];

export const buildSlimCsv = (rows, headers) => {
  if (!rows.length || !headers.length) return '';
  // For YouTube JSON, just return the main fields as CSV for context
  const slimHeaders = ['title', 'viewCount', 'likeCount', 'commentCount', 'duration', 'releaseDate', 'videoUrl'];
  const escapeCell = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    slimHeaders.join(','),
    ...rows.map((r) => slimHeaders.map((h) => escapeCell(r[h])).join(',')),
  ];
  return lines.join('\n');
};

// ── Enrich rows with computed engagement column ───────────────────────────────
// Adds engagement = Favorite Count / View Count to every row.
// Returns { rows: enrichedRows, headers: updatedHeaders }.
// Safe to call even if the columns aren't present (skips gracefully).

export const enrichWithEngagement = (rows, headers) => {
  if (!rows.length) return { rows, headers };
  // YouTube JSON: likeCount and viewCount
  const likeCol = headers.find((h) => /likeCount/i.test(h));
  const viewCol = headers.find((h) => /viewCount/i.test(h));
  if (!likeCol || !viewCol) return { rows, headers };
  if (headers.includes('engagement')) return { rows, headers };
  const enriched = rows.map((r) => {
    const likes = parseFloat(r[likeCol]);
    const views = parseFloat(r[viewCol]);
    const eng = !isNaN(likes) && !isNaN(views) && views > 0 ? +(likes / views).toFixed(6) : null;
    return { ...r, engagement: eng };
  });
  return { rows: enriched, headers: [...headers, 'engagement'] };
};

// ── Dataset summary (auto-computed when CSV is loaded) ───────────────────────
// Returns a compact markdown string describing every column so Gemini always
// has exact column names, types, and value distributions in its context.

export const computeDatasetSummary = (rows, headers) => {
  if (!rows.length || !headers.length) return '';

  const lines = [`**Dataset: ${rows.length} rows × ${headers.length} columns**\n`];
  const numericCols = [];
  const categoricalCols = [];

  headers.forEach((h) => {
    const vals = rows.map((r) => r[h]).filter((v) => v !== '' && v !== undefined && v !== null);
    const numVals = vals.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
    const numericRatio = numVals.length / (vals.length || 1);

    if (numericRatio >= 0.8 && numVals.length > 0) {
      const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
      numericCols.push({
        name: h,
        count: numVals.length,
        mean: +mean.toFixed(2),
        min: Math.min(...numVals),
        max: Math.max(...numVals),
      });
    } else {
      const counts = {};
      vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([v, n]) => `${v} (${n})`)
        .join(', ');
      categoricalCols.push({ name: h, unique: Object.keys(counts).length, top });
    }
  });

  if (numericCols.length) {
    lines.push('**Numeric columns** (exact names — use these verbatim in tool calls):');
    numericCols.forEach((c) => {
      lines.push(`  • "${c.name}": mean=${c.mean}, min=${c.min}, max=${c.max}, n=${c.count}`);
    });
  }

  if (categoricalCols.length) {
    lines.push('\n**Categorical columns** (exact names — use these verbatim in tool calls):');
    categoricalCols.forEach((c) => {
      lines.push(`  • "${c.name}": ${c.unique} unique values — top: ${c.top}`);
    });
  }

  return lines.join('\n');
};

// ── Client-side tool executor ─────────────────────────────────────────────────

export const executeTool = async (toolName, args, rows, context = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const availableHeaders = safeRows.length ? Object.keys(safeRows[0]) : [];
  console.group(`[CSV Tool] ${toolName}`);
  console.log('args:', args);
  console.log('rows loaded:', safeRows.length);
  console.log('available headers:', availableHeaders);
  console.groupEnd();

  switch (toolName) {
    case 'compute_column_stats': {
      const col = resolveCol(safeRows, args.column);
      console.log(`[compute_column_stats] resolved column: "${args.column}" → "${col}"`);
      const vals = numericValues(safeRows, col);
      if (!vals.length)
        return { error: `No numeric values found in column "${col}". Available columns: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        column: col,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'get_value_counts': {
      const col = resolveCol(safeRows, args.column);
      console.log(`[get_value_counts] resolved column: "${args.column}" → "${col}"`);
      const topN = args.top_n || 10;
      const counts = {};
      safeRows.forEach((r) => {
        const v = r[col];
        if (v !== undefined && v !== '') counts[v] = (counts[v] || 0) + 1;
      });
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
      return {
        column: col,
        total_rows: safeRows.length,
        value_counts: Object.fromEntries(sorted),
      };
    }

    case 'get_top_items': {
      const sortCol = resolveCol(safeRows, args.sort_column) || args.sort_column;
      console.log(`[get_top_tweets] sort="${sortCol}" n=${args.n} asc=${args.ascending}`);
      const n   = args.n || 10;
      const asc = args.ascending ?? false;

      // Detect text column for display (YouTube title or Twitter text)
      const textCol =
        availableHeaders.find((h) => /^title$/i.test(h)) ||
        availableHeaders.find((h) => /^text$/i.test(h)) ||
        availableHeaders.find((h) => /text|content|tweet|body/i.test(h));

      // Detect key metric columns
      const favCol  = availableHeaders.find((h) => /favorite.?count/i.test(h)) || availableHeaders.find((h) => /like.?count/i.test(h));
      const viewCol = availableHeaders.find((h) => /view.?count/i.test(h));
      const engCol  = availableHeaders.includes('engagement') ? 'engagement' : null;

      const sorted = [...safeRows].sort((a, b) => {
        const av = parseFloat(a[sortCol]);
        const bv = parseFloat(b[sortCol]);
        if (!isNaN(av) && !isNaN(bv)) return asc ? av - bv : bv - av;
        return 0;
      });

      const topRows = sorted.slice(0, n).map((r, i) => {
        const out = { rank: i + 1 };
        if (textCol) out.text = String(r[textCol] || '').slice(0, 150);
        if (favCol)  out[favCol]  = r[favCol];
        if (viewCol) out[viewCol] = r[viewCol];
        if (engCol)  out.engagement = r.engagement;
        return out;
      });

      if (!topRows.length)
        return { error: `No rows found. Column "${sortCol}" may not exist. Available: ${availableHeaders.join(', ')}` };

      return {
        sort_column: sortCol,
        direction: asc ? 'ascending (lowest first)' : 'descending (highest first)',
        count: topRows.length,
        tweets: topRows,
      };
    }

    case 'generateImage': {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return { error: 'prompt is required for generateImage' };

      const anchorImage = args.anchor_image || context.anchorImage || null;
      // Call backend endpoint to fetch Pollinations image as base64
      return fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, anchorImage }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Backend image proxy failed');
          const data = await res.json();
          return {
            inlineData: {
              mimeType: data.mimeType,
              data: data.data,
            },
            _chartType: 'generatedImage',
            prompt,
            anchorUsed: !!anchorImage,
            url: data.url,
            fileName: data.fileName,
            message: 'Generated image preview ready.',
          };
        })
        .catch((err) => ({ error: 'Image generation failed: ' + err.message }));
    }

    case 'plot_metric_vs_time': {
      const metricCol = resolveCol(safeRows, args.metric);
      const timeCol = resolveCol(safeRows, args.time_column);
      console.log(`[plot_metric_vs_time] metric="${metricCol}" time="${timeCol}"`);

      // Build time-series data points
      const dataPoints = safeRows
        .map((r) => {
          const time = r[timeCol];
          const val = parseFloat(r[metricCol]);
          if (!time || isNaN(val)) return null;
          return { time, value: val };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      if (!dataPoints.length)
        return { error: `No valid data points for "${metricCol}" vs "${timeCol}". Available columns: ${availableHeaders.join(', ')}` };

      return {
        _chartType: 'timeSeries',
        metric: metricCol,
        timeColumn: timeCol,
        data: dataPoints.map((d) => ({ name: d.time, [metricCol]: d.value })),
        count: dataPoints.length,
      };
    }

    case 'play_video': {
      const titleQuery = (args.title || '').toLowerCase().trim();
      
      // YouTube-specific column detection - exact names first
      const titleCol = availableHeaders.find((h) => /^title$/i.test(h));
      const urlCol = availableHeaders.find((h) => /^videoUrl$/i.test(h));
      const thumbCol = availableHeaders.find((h) => /^thumbnailUrl$/i.test(h));
      const viewCol = availableHeaders.find((h) => /^viewCount$/i.test(h));
      const likeCol = availableHeaders.find((h) => /like.?count/i.test(h));

      if (!titleCol || !urlCol) {
        return { error: `Cannot find required columns. Have: ${availableHeaders.join(', ')}` };
      }

      let bestMatch = null;

      // Handle special queries
      if (/^(first|1st|one)$/i.test(titleQuery) && safeRows.length > 0) {
        bestMatch = safeRows[0];
      } else if (/^(last|latest)$/i.test(titleQuery) && safeRows.length > 0) {
        bestMatch = safeRows[safeRows.length - 1];
      } else if (/^(most\s*viewed|most\s*popular|top\s*video|highest\s*views)$/i.test(titleQuery)) {
        // Find video with most views
        if (viewCol && safeRows.length > 0) {
          bestMatch = safeRows.reduce((max, r) => {
            const maxViews = parseFloat(max[viewCol]) || 0;
            const rViews = parseFloat(r[viewCol]) || 0;
            return rViews > maxViews ? r : max;
          });
        } else if (safeRows.length > 0) {
          bestMatch = safeRows[0];
        }
      } else if (/^(most\s*liked|most\s*loved|highest\s*likes|top\s*liked|most\s*like)/i.test(titleQuery)) {
        // Find video with most likes
        if (likeCol && safeRows.length > 0) {
          bestMatch = safeRows.reduce((max, r) => {
            const maxLikes = parseFloat(max[likeCol]) || 0;
            const rLikes = parseFloat(r[likeCol]) || 0;
            return rLikes > maxLikes ? r : max;
          });
        } else if (safeRows.length > 0) {
          bestMatch = safeRows[0];
        }
      } else {
        // Search by title or partial match
        for (const r of safeRows) {
          const rowTitle = String(r[titleCol] || '').toLowerCase();
          if (rowTitle.includes(titleQuery)) {
            bestMatch = r;
            break;
          }
        }
      }

      if (!bestMatch || !bestMatch[titleCol]) {
        return { error: `No video found matching "${args.title}". Available: ${safeRows.slice(0, 3).map(r => r[titleCol]).join(', ')}` };
      }

      const videoTitle = bestMatch[titleCol];
      const videoUrl = bestMatch[urlCol];
      const thumbnailUrl = thumbCol ? bestMatch[thumbCol] : null;

      if (!videoUrl) {
        return { error: `Video "${videoTitle}" found but missing URL.` };
      }

      return {
        _playVideo: true,
        title: videoTitle,
        thumbnailUrl,
        url: videoUrl,
        message: `Playing: "${videoTitle}"`,
      };
    }

    case 'compute_stats_json': {
      const col = resolveCol(safeRows, args.field);
      console.log(`[compute_stats_json] resolved field: "${args.field}" → "${col}"`);
      const vals = numericValues(safeRows, col);
      if (!vals.length)
        return { error: `No numeric values found in field "${col}". Available columns: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        field: col,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};
