import { useState, useRef } from 'react';
import './YouTubeDownload.css';

const PENDING_YT_JSON_KEY = 'chatapp_pending_yt_json';


export default function YouTubeDownload({ onSwitchToChat }) {
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(10);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const eventSourceRef = useRef(null);

  const handleDownload = (e) => {
    if (e) e.preventDefault();
    if (!channelUrl.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    setHasStarted(true);
    setProgress({ current: 0, total: maxVideos, message: 'Starting...' });

    const params = new URLSearchParams({
      url: channelUrl.trim(),
      maxVideos: String(Math.min(100, Math.max(1, maxVideos))),
    });

    const es = new EventSource(`/api/youtube/channel-data?${params}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          setProgress({ current: data.current, total: data.total, message: data.message });
        } else if (data.type === 'complete') {
          const downloadResult = {
            data: data.data,
            fileName: data.fileName,
            channelTitle: data.channelTitle,
            savedPath: data.savedPath,
            savedAbsolutePath: data.savedAbsolutePath,
            timestamp: new Date().toISOString(),
          };
          setResult(downloadResult);
          setLoading(false);
          es.close();
        } else if (data.type === 'error') {
          setError(data.message);
          setLoading(false);
          es.close();
        }
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };

    es.onerror = () => {
      if (loading) {
        setError('Connection lost. Please try again.');
        setLoading(false);
      }
      es.close();
    };
  };

  const handleStop = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      setLoading(false);
      setProgress((p) => ({ ...p, message: 'Cancelled.' }));
    }
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName || 'channel_data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAnalyzeInChat = () => {
    if (!result) return;
    localStorage.setItem(PENDING_YT_JSON_KEY, JSON.stringify({
      data: result.data,
      fileName: result.fileName,
      channelTitle: result.channelTitle,
    }));
    if (typeof onSwitchToChat === 'function') {
      onSwitchToChat();
    } else {
      // fallback: just switch tab in localStorage (should not reload)
      localStorage.setItem('chatapp_active_tab', 'chat');
    }
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="yt-download">
      <div className="yt-download-card">
        <h2 className="yt-title">📺 YouTube Channel Download</h2>
        <p className="yt-subtitle">Enter a YouTube channel URL to download video metadata, stats, and transcripts.</p>

        <form className="yt-form" onSubmit={handleDownload} autoComplete="off">
          <label className="yt-label">Channel URL</label>
          <input
            type="text"
            className="yt-input"
            placeholder="https://www.youtube.com/@veritasium"
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            disabled={loading}
          />

          <label className="yt-label">Max Videos</label>
          <input
            type="number"
            className="yt-input yt-input-small"
            min={1}
            max={100}
            value={maxVideos}
            onChange={(e) => setMaxVideos(Math.min(100, Math.max(1, parseInt(e.target.value) || 10)))}
            disabled={loading}
          />

          <div className="yt-btn-row">
            {loading ? (
              <button type="button" onClick={handleStop} className="yt-stop-btn">■ Stop</button>
            ) : (
              <button
                type="submit"
                disabled={!channelUrl.trim()}
                className="yt-download-btn"
              >
                Download Channel Data
              </button>
            )}
          </div>
        </form>

        {/* Progress bar and error only after download started */}
        {hasStarted && (
          <>
            {loading && (
              <div className="yt-progress">
                <div className="yt-progress-bar">
                  <div className="yt-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <p className="yt-progress-text">
                  {progress.message} {progressPercent > 0 && `(${progressPercent}%)`}
                </p>
              </div>
            )}
            {error && <p className="yt-error">❌ {error}</p>}
            {/* Results only after successful download */}
            {result && !loading && !error && (
              <div className="yt-result">
                <h3 className="yt-result-title">
                  ✅ Downloaded {result.data.length} videos from {result.channelTitle}
                </h3>
                {result.savedPath && (
                  <p className="yt-result-saved">
                    💾 Saved to: <code>{result.savedPath}</code>
                  </p>
                )}
                {result.savedAbsolutePath && (
                  <p className="yt-result-saved">
                    📂 Full path: <code>{result.savedAbsolutePath}</code>
                  </p>
                )}
                {result.timestamp && (
                  <p className="yt-result-saved">
                    🕐 Downloaded at: {new Date(result.timestamp).toLocaleString()}
                  </p>
                )}
                <div className="yt-btn-row">
                  <button type="button" onClick={handleAnalyzeInChat} className="yt-json-btn">
                    💬 Analyze in Chat with Lisa
                  </button>
                  <button type="button" onClick={handleDownloadJson} className="yt-json-btn yt-json-btn-secondary">
                    📥 Download JSON File
                  </button>
                </div>
                <p className="yt-drag-hint">
                  💡 Click "Analyze in Chat with Lisa" to load this data directly into the chat!
                </p>
                <div className="yt-preview">
                  <h4>Preview ({Math.min(5, result.data.length)} of {result.data.length} videos):</h4>
                  <div className="yt-video-list">
                    {result.data.slice(0, 5).map((v, i) => (
                      <div key={i} className="yt-video-item">
                        {v.thumbnailUrl && (
                          <img src={v.thumbnailUrl} alt="" className="yt-thumb" />
                        )}
                        <div className="yt-video-info">
                          <a href={v.videoUrl} target="_blank" rel="noreferrer" className="yt-video-title">
                            {v.title}
                          </a>
                          <span className="yt-video-stats">
                            {(v.viewCount || 0).toLocaleString()} views · {(v.likeCount || 0).toLocaleString()} likes · {v.duration}
                          </span>
                          <span className="yt-video-date">
                            {new Date(v.releaseDate).toLocaleDateString()}
                          </span>
                          {v.transcript && (
                            <span className="yt-transcript-badge">📝 Transcript available</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {result.data.length > 5 && (
                      <p className="yt-more">... and {result.data.length - 5} more videos</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
