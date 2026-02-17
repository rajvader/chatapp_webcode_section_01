import { useState, useEffect, useRef } from 'react';
import { streamChat } from '../services/gemini';
import { saveMessage, loadMessages } from '../services/mongoApi';
import './Chat.css';

export default function Chat({ username, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadMessages(username).then(setMessages);
  }, [username]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const newImages = await Promise.all(
      files.map(async (f) => ({
        data: await fileToBase64(f),
        mimeType: f.type,
        name: f.name,
      }))
    );
    setImages((prev) => [...prev, ...newImages]);
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length) || streaming) return;

    const userContent = text || '(Image)';
    const userMsg = {
      id: `u-${Date.now()}`,
      username,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setImages([]);
    setStreaming(true);

    await saveMessage(username, 'user', userContent, images.length ? images : null);

    const imageParts = images.map((img) => ({ mimeType: img.mimeType, data: img.data }));
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content }));

    const promptForGemini = text || (imageParts.length ? 'What do you see in this image?' : '');
    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [...m, { id: assistantId, username, role: 'model', content: '', timestamp: new Date().toISOString() }]);

    let fullContent = '';
    try {
      for await (const chunk of streamChat(history, promptForGemini, imageParts)) {
        fullContent += chunk;
        setMessages((m) =>
          m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
        );
      }
    } catch (err) {
      fullContent = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
      );
    }

    await saveMessage(username, 'model', fullContent);
    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <h1>Chat</h1>
        <div className="chat-header-right">
          <span className="chat-user">{username}</span>
          <button onClick={onLogout} className="chat-logout">
            Log out
          </button>
        </div>
      </header>

      <div
        className={`chat-messages ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-msg-meta">
              <span className="chat-msg-role">{m.role === 'user' ? username : 'Gemini'}</span>
              <span className="chat-msg-time">
                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {m.images?.length > 0 && (
              <div className="chat-msg-images">
                {m.images.map((img, i) => (
                  <img
                    key={i}
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt=""
                    className="chat-msg-thumb"
                  />
                ))}
              </div>
            )}
            <div className="chat-msg-content">{m.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {dragOver && (
        <div className="chat-drop-overlay">
          Drop images here
        </div>
      )}

      <div className="chat-input-area">
        {images.length > 0 && (
          <div className="chat-image-previews">
            {images.map((img, i) => (
              <div key={i} className="chat-img-preview">
                <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                <button type="button" onClick={() => removeImage(i)} aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message or drag images here..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={streaming}
          />
          <button onClick={handleSend} disabled={streaming || (!input.trim() && !images.length)}>
            {streaming ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
