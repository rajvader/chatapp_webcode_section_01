// ── 1. Tool Declarations (Tells Gemini what tools exist) ──────────────
export const CSV_TOOL_DECLARATIONS = [
  {
    name: 'generateImage',
    description: 'Generate an image from a text prompt. The system handles anchor images automatically.',
    parameters: {
      type: 'OBJECT',
      properties: { prompt: { type: 'STRING' } },
      required: ['prompt'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description: 'Plot any numeric field (e.g. viewCount, likeCount, commentCount) vs time for the channel videos.',
    parameters: {
      type: 'OBJECT',
      properties: { metric: { type: 'STRING' } },
      required: ['metric'],
    },
  },
  {
    name: 'play_video',
    description: 'Play a YouTube video in the chat. Specify the video by title, ordinal (e.g. "first video"), or keyword ("most viewed").',
    parameters: {
      type: 'OBJECT',
      properties: { title: { type: 'STRING' } },
      required: ['title'],
    },
  },
  {
    name: 'compute_stats_json',
    description: 'Computes mean, median, std, min, and max for any numeric field in the channel JSON.',
    parameters: {
      type: 'OBJECT',
      properties: { field: { type: 'STRING' } },
      required: ['field'],
    },
  }
];

// ── 2. Data Preparation Helpers ───────────────────────────────────────
export const parseCsvToRows = (text) => {
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return { rows: [], headers: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] }), {});
  });
  return { rows, headers };
};

export const enrichWithEngagement = (rows, headers) => {
  if (!rows || !rows.length) return { rows: [], headers: [] };
  const enrichedRows = rows.map(row => {
    const viewCount = parseFloat(row.viewCount) || 0;
    const likeCount = parseFloat(row.likeCount) || 0;
    const engagement = viewCount > 0 ? likeCount / viewCount : 0;
    return { ...row, engagement };
  });
  const newHeaders = headers.includes('engagement') ? headers : [...headers, 'engagement'];
  return { rows: enrichedRows, headers: newHeaders };
};

export const computeDatasetSummary = (rows, headers) => {
  if (!rows || rows.length === 0) return '';
  return `Dataset loaded with ${rows.length} videos. Available metrics include views, likes, comments, and engagement.`;
};

export const buildSlimCsv = (rows, headers) => {
  if (!rows || !rows.length) return '';
  const slimHeaders = ['title', 'viewCount', 'likeCount', 'commentCount', 'engagement'];
  const headerRow = slimHeaders.join(',');
  const dataRows = rows.map(r => slimHeaders.map(h => r[h] || '').join(',')).join('\n');
  return `${headerRow}\n${dataRows}`.slice(0, 15000); 
};

// ── 3. Tool Execution Engine (Runs when Gemini calls a tool) ──────────
export const executeTool = async (name, args, rows = [], context = {}) => {
  switch (name) {
    
    case 'generateImage':
      try {
        const prompt = args.prompt || "A cool image";
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, anchorImage: context.anchorImage || null })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch image');
        
        return {
          _chartType: 'generatedImage',
          data: data.data,
          mimeType: data.mimeType,
          url: data.url,
          prompt: prompt,
          fileName: data.fileName
        };
      } catch (e) {
        return { error: `Image generation failed: ${e.message}` };
      }

    case 'plot_metric_vs_time': {
      let plotMetric = (args.metric || 'viewCount').toString().toLowerCase();
      
      if (plotMetric.includes('view')) plotMetric = 'viewCount';
      else if (plotMetric.includes('like')) plotMetric = 'likeCount';
      else if (plotMetric.includes('comment')) plotMetric = 'commentCount';
      else if (plotMetric.includes('engage')) plotMetric = 'engagement';

      const validPlotData = rows
        .filter(r => r[plotMetric] !== undefined && r.releaseDate)
        .map(r => ({
          date: new Date(r.releaseDate).getTime(),
          dateStr: r.releaseDate.split('T')[0],
          title: r.title,
          value: parseFloat(r[plotMetric]) || 0
        }))
        .sort((a, b) => a.date - b.date);

      if (!validPlotData.length) return { error: `No valid data for ${plotMetric}` };
      
      return {
        _chartType: 'timeSeries',
        metric: plotMetric,
        data: validPlotData.map(d => ({ 
          x: d.dateStr, 
          y: d.value, 
          date: d.dateStr,         // Fallback for some charts
          [plotMetric]: d.value,   // ✨ THE MAGIC KEY (e.g., viewCount: 150000)
          label: d.title 
        }))
      };
    }

    case 'play_video': {
      const searchTitle = (args.title || '').toString().toLowerCase();
      let video = rows.find(r => r.title && r.title.toLowerCase().includes(searchTitle));
      
      if (!video) {
        if (searchTitle.includes('most viewed')) {
          video = [...rows].sort((a, b) => (parseFloat(b.viewCount) || 0) - (parseFloat(a.viewCount) || 0))[0];
        } else if (searchTitle.includes('most liked')) {
          video = [...rows].sort((a, b) => (parseFloat(b.likeCount) || 0) - (parseFloat(a.likeCount) || 0))[0];
        } else {
          video = rows[0]; 
        }
      }

      if (!video) return { error: 'Video not found.' };

      return {
        _playVideo: true,
        title: video.title,
        url: video.videoUrl || `https://youtube.com/watch?v=${video.videoId}`,
        thumbnailUrl: video.thumbnailUrl
      };
    }

    case 'compute_stats_json': {
      let statField = (args.field || 'viewCount').toString().toLowerCase();
      
      if (statField.includes('view')) statField = 'viewCount';
      else if (statField.includes('like')) statField = 'likeCount';
      else if (statField.includes('comment')) statField = 'commentCount';
      else if (statField.includes('engage')) statField = 'engagement';

      const values = rows.map(r => parseFloat(r[statField])).filter(v => !isNaN(v));
      if (!values.length) return { error: `No numeric data for ${statField}` };

      values.sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const mean = sum / values.length;
      const median = values.length % 2 === 0 
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2 
        : values[Math.floor(values.length / 2)];
      
      const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
      const std = Math.sqrt(variance);

      return { 
        field: statField, 
        count: values.length, 
        mean: Math.round(mean * 100) / 100, 
        median, 
        std: Math.round(std * 100) / 100, 
        min: values[0], 
        max: values[values.length - 1] 
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
};