import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { loadMessages, saveMessages, uploadEncryptedFile, downloadEncryptedFile, deleteFileFromDrive } from '../lib/storage';
import { encryptText, decryptText, encryptFile, decryptFile } from '../lib/encryption';
import { Send, Paperclip, Lock, File, Loader2, X, AlertCircle, Trash2, Copy, Check, ExternalLink } from 'lucide-react';

const MAX_FILE_MB = 100;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// ── URL detection regex ───────────────────────────────────────────────────────
const URL_REGEX = /(https?:\/\/[^\s<>"'`)\]},;]+)/gi;

/**
 * Parse text and return an array of React elements with clickable links.
 */
function renderTextWithLinks(text) {
  if (!text) return null;
  const parts = [];
  let lastIndex = 0;
  let match;

  URL_REGEX.lastIndex = 0; // reset regex state
  while ((match = URL_REGEX.exec(text)) !== null) {
    // Text before the URL
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // The URL itself
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#c7d2fe',
          textDecoration: 'underline',
          textDecorationColor: 'rgba(199,210,254,0.4)',
          wordBreak: 'break-all',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
        <ExternalLink size={11} style={{ display: 'inline', marginLeft: '3px', verticalAlign: 'middle', opacity: 0.7 }} />
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CHAT COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function Chat() {
  const { encryptionKey, logout } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [deletingIds, setDeletingIds] = useState(new Set());
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    fetchMessages();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Helper to extract error message from standard Errors or Google API errors
  const getErrorMessage = (e) => {
    if (e?.result?.error?.message) return e.result.error.message;
    if (e?.message) return e.message;
    if (typeof e === 'string') return e;
    try { return JSON.stringify(e); } catch { return 'Unknown error'; }
  };

  const fetchMessages = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const encryptedMessages = await loadMessages();
      const decrypted = [];
      for (const msg of encryptedMessages) {
        if (msg.type === 'text') {
          try {
            const text = await decryptText(msg.content, encryptionKey);
            decrypted.push({ ...msg, decryptedContent: text });
          } catch {
            decrypted.push({ ...msg, decryptedContent: '[Unable to decrypt — wrong key?]', corrupt: true });
          }
        } else {
          decrypted.push({ ...msg });
        }
      }
      setMessages(decrypted);
    } catch (e) {
      console.error("Fetch messages error:", e);
      setLoadError(`Failed to load messages: ${getErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async (e) => {
    e.preventDefault();
    if ((!inputText.trim() && !selectedFile) || isSending) return;

    setIsSending(true);
    setSendError('');

    try {
      const storedMessages = messages.map(({ decryptedContent, objectUrl, ...rest }) => rest);
      const newDisplayMessages = [...messages];

      if (selectedFile) {
        const fileMsg = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: selectedFile.type.startsWith('image/')
            ? 'image'
            : selectedFile.type.startsWith('video/')
            ? 'video'
            : 'file',
          fileName: selectedFile.name,
          mimeType: selectedFile.type,
        };

        const encryptedBlob = await encryptFile(selectedFile, encryptionKey);
        fileMsg.fileId = await uploadEncryptedFile(encryptedBlob, `enc_${crypto.randomUUID()}`);

        storedMessages.push(fileMsg);
        newDisplayMessages.push(fileMsg);
      }

      if (inputText.trim()) {
        const textMsg = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'text',
          content: await encryptText(inputText, encryptionKey),
        };
        storedMessages.push(textMsg);
        newDisplayMessages.push({ ...textMsg, decryptedContent: inputText });
      }

      await saveMessages(storedMessages);

      setMessages(newDisplayMessages);
      setInputText('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Refocus input for fast consecutive messages
      inputRef.current?.focus();
    } catch (e) {
      console.error("Send message error:", e);
      setSendError(`Failed to send: ${getErrorMessage(e)}`);
    } finally {
      setIsSending(false);
    }
  };

  // ── Delete message ──────────────────────────────────────────────────────────

  const handleDelete = async (msgId) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    setDeletingIds((prev) => new Set([...prev, msgId]));

    try {
      // If it's a file message, delete the encrypted blob from Drive too
      if (msg.fileId) {
        await deleteFileFromDrive(msg.fileId);
      }

      // Remove from message list and save
      const remaining = messages.filter((m) => m.id !== msgId);
      const storedMessages = remaining.map(({ decryptedContent, objectUrl, ...rest }) => rest);
      await saveMessages(storedMessages);
      setMessages(remaining);
    } catch (e) {
      console.error("Delete message error:", e);
      setSendError(`Failed to delete: ${getErrorMessage(e)}`);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const handleFileChange = (e) => {
    setFileError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`File too large. Maximum size is ${MAX_FILE_MB} MB.`);
      e.target.value = '';
      return;
    }
    setSelectedFile(file);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="glass" style={{
        padding: '0.875rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '42px', height: '42px', borderRadius: '14px',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: '0.875rem', flexShrink: 0,
          }}>
            ME
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Self Notes</h2>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }} />
              End-to-end encrypted
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {messages.length} msg{messages.length !== 1 ? 's' : ''}
          </span>
          <button id="lock-btn" onClick={logout} className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', gap: '0.4rem' }}>
            <Lock size={14} />
            Lock
          </button>
        </div>
      </header>

      {/* ── Messages ────────────────────────────────────────────────────── */}
      <main style={{
        flex: 1, overflowY: 'auto', padding: '1.5rem',
        display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0,
      }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <Loader2 className="lucide-spin" size={32} color="var(--accent-primary)" />
          </div>
        ) : loadError ? (
          <ErrorBanner message={loadError} onRetry={fetchMessages} />
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Date separators + messages */}
            {messages.map((msg, i) => {
              const showDate = i === 0 || !isSameDay(msg.timestamp, messages[i - 1].timestamp);
              return (
                <React.Fragment key={msg.id}>
                  {showDate && <DateSeparator date={msg.timestamp} />}
                  <MessageBubble
                    msg={msg}
                    encryptionKey={encryptionKey}
                    onDelete={() => handleDelete(msg.id)}
                    isDeleting={deletingIds.has(msg.id)}
                  />
                </React.Fragment>
              );
            })}
          </>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* ── Input Area ──────────────────────────────────────────────────── */}
      <footer className="glass" style={{
        padding: '1rem 1.5rem',
        borderTop: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        {(selectedFile || fileError) && (
          <div style={{ marginBottom: '0.75rem' }}>
            {fileError && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                color: 'var(--error)', fontSize: '0.8rem', padding: '0.4rem 0.75rem',
                background: 'rgba(239,68,68,0.1)', borderRadius: '8px',
                border: '1px solid rgba(239,68,68,0.2)',
              }}>
                <AlertCircle size={14} />{fileError}
              </div>
            )}
            {selectedFile && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.4rem 0.75rem', background: 'var(--bg-tertiary)',
                borderRadius: '8px', fontSize: '0.8rem', border: '1px solid var(--border-color)',
                maxWidth: '100%',
              }}>
                <File size={14} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                  {selectedFile.name}
                </span>
                <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                  ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                </span>
                <button onClick={clearFile} id="clear-file-btn"
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0', display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {sendError && (
          <div style={{ marginBottom: '0.75rem', color: 'var(--error)', fontSize: '0.8rem' }}>
            <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            {sendError}
          </div>
        )}

        <form id="message-form" onSubmit={handleSend} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input ref={fileInputRef} type="file" id="file-upload" style={{ display: 'none' }} onChange={handleFileChange} />
          <label htmlFor="file-upload" className="btn btn-secondary"
            style={{ padding: '0.65rem', borderRadius: '12px', flexShrink: 0, cursor: 'pointer' }} title="Attach file">
            <Paperclip size={18} />
          </label>

          <input
            ref={inputRef}
            id="message-input"
            className="input"
            style={{ borderRadius: '12px', fontSize: '0.9rem' }}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a secure message…"
            autoComplete="off"
          />

          <button id="send-btn" type="submit" className="btn btn-primary"
            disabled={isSending || (!inputText.trim() && !selectedFile)}
            style={{ borderRadius: '12px', padding: '0.65rem', flexShrink: 0 }} title="Send">
            {isSending ? <Loader2 className="lucide-spin" size={18} /> : <Send size={18} />}
          </button>
        </form>
      </footer>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSameDay(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function DateSeparator({ date }) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  let label;
  if (isSameDay(d, today)) label = 'Today';
  else if (isSameDay(d, yesterday)) label = 'Yesterday';
  else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });

  return (
    <div style={{
      textAlign: 'center', padding: '0.5rem 0',
      display: 'flex', alignItems: 'center', gap: '1rem',
    }}>
      <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, encryptionKey, onDelete, isDeleting }) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); };
  }, [mediaUrl]);

  useEffect(() => {
    if ((msg.type === 'image' || msg.type === 'video') && !mediaUrl && !isLoadingMedia) {
      loadMedia();
    }
  }, [msg.id]);

  const loadMedia = async () => {
    if (isLoadingMedia) return;
    setIsLoadingMedia(true);
    setMediaError('');
    try {
      const encryptedBlob = await downloadEncryptedFile(msg.fileId);
      const decryptedBlob = await decryptFile(encryptedBlob, encryptionKey, msg.mimeType);
      setMediaUrl(URL.createObjectURL(decryptedBlob));
    } catch {
      setMediaError('Failed to decrypt media.');
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const handleCopy = async () => {
    if (msg.type === 'text' && msg.decryptedContent) {
      await navigator.clipboard.writeText(msg.decryptedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const isMedia = msg.type === 'image' || msg.type === 'video';

  return (
    <div
      style={{ alignSelf: 'flex-end', maxWidth: 'min(80%, 560px)', position: 'relative' }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Action bar (appears on hover) */}
      <div style={{
        position: 'absolute', top: '-6px', right: '8px',
        display: showActions ? 'flex' : 'none',
        gap: '2px', background: 'var(--bg-secondary)',
        borderRadius: '8px', padding: '2px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: 5,
      }}>
        {msg.type === 'text' && (
          <button onClick={handleCopy} title="Copy text"
            style={{ ...actionBtnStyle }}>
            {copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          title="Delete message"
          style={{ ...actionBtnStyle, color: isDeleting ? 'var(--text-secondary)' : 'var(--error)' }}
        >
          {isDeleting ? <Loader2 className="lucide-spin" size={13} /> : <Trash2 size={13} />}
        </button>
      </div>

      {/* Bubble */}
      <div
        className="animate-fade-in"
        style={{
          background: msg.corrupt
            ? 'rgba(239,68,68,0.2)'
            : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          color: 'white',
          padding: isMedia && mediaUrl ? '0.5rem' : '0.75rem 1rem',
          borderRadius: '16px 16px 2px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          wordBreak: 'break-word',
          opacity: isDeleting ? 0.5 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        {/* Text with clickable links */}
        {msg.type === 'text' && (
          <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>
            {renderTextWithLinks(msg.decryptedContent)}
          </p>
        )}

        {/* Image */}
        {msg.type === 'image' && (
          <>
            {isLoadingMedia && <Loader2 className="lucide-spin" size={20} />}
            {mediaError && <MediaError message={mediaError} onRetry={loadMedia} />}
            {mediaUrl && (
              <img src={mediaUrl} alt={msg.fileName}
                style={{ maxWidth: '100%', borderRadius: '12px', display: 'block' }} />
            )}
          </>
        )}

        {/* Video */}
        {msg.type === 'video' && (
          <>
            {isLoadingMedia && <Loader2 className="lucide-spin" size={20} />}
            {mediaError && <MediaError message={mediaError} onRetry={loadMedia} />}
            {mediaUrl && (
              <video src={mediaUrl} controls
                style={{ maxWidth: '100%', borderRadius: '12px', display: 'block' }} />
            )}
          </>
        )}

        {/* Generic file */}
        {msg.type === 'file' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <File size={18} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.fileName}</span>
            {mediaUrl ? (
              <a href={mediaUrl} download={msg.fileName}
                style={{ color: 'white', textDecoration: 'underline', marginLeft: 'auto' }}>
                Download
              </a>
            ) : isLoadingMedia ? (
              <Loader2 className="lucide-spin" size={14} />
            ) : mediaError ? (
              <MediaError message={mediaError} onRetry={loadMedia} />
            ) : (
              <button onClick={loadMedia}
                style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
                  padding: '3px 10px', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '0.8rem', marginLeft: 'auto',
                }}>
                Decrypt &amp; Download
              </button>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div style={{ fontSize: '0.65rem', opacity: 0.65, textAlign: 'right', marginTop: '0.3rem' }}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

const actionBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '5px 7px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  transition: 'background 0.15s',
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function MediaError({ message, onRetry }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', opacity: 0.9 }}>
      <AlertCircle size={14} />
      {message}
      <button onClick={onRetry}
        style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
        Retry
      </button>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '0.75rem', margin: 'auto', color: 'var(--text-secondary)', textAlign: 'center',
    }}>
      <AlertCircle size={32} color="var(--error)" />
      <p style={{ margin: 0 }}>{message}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry} style={{ fontSize: '0.85rem' }}>
          Retry
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '0.75rem', margin: 'auto', color: 'var(--text-secondary)',
      textAlign: 'center', padding: '2rem',
    }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: '20px',
        background: 'var(--bg-tertiary)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Send size={28} color="var(--accent-primary)" />
      </div>
      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary)' }}>No messages yet</p>
      <p style={{ margin: 0, fontSize: '0.875rem' }}>
        Send your first encrypted note, image, or file to yourself.
      </p>
    </div>
  );
}
