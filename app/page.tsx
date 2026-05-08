"use client";

import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from "react";
import { marked } from "marked";

// Configure marked for inline rendering (no wrapping <p> tags for short content)
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

const API_BASE = "http://localhost:3000/api/v1/advisor";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const IconSend = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
);

const PROMPT_CHIPS = [
  "What is entrepreneurship?",
  "How do I find product-market fit?",
  "What is the difference between sales and marketing?",
  "How do I scale my business?",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdvisorPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingConvos, setLoadingConvos] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Direct DOM refs for streaming — bypasses React batching entirely
  const streamingBubbleRef = useRef<HTMLSpanElement>(null);
  const streamingContentRef = useRef<string>("");

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, isStreaming]);

  // ── Sync first chunk into DOM after bubble mounts ────────────────────────────
  useEffect(() => {
    if (isStreaming && !isThinking && streamingBubbleRef.current) {
      streamingBubbleRef.current.innerHTML = renderMarkdown(streamingContentRef.current);
    }
  }, [isStreaming, isThinking]);

  // ── Auto-resize textarea ─────────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "24px";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // ── Load conversations on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    setLoadingConvos(true);
    try {
      const res = await fetch(`${API_BASE}?limit=50`);
      const json = await res.json();
      if (json.success) setConversations(json.data?.data ?? []);
    } catch {
      /* silent — server might not be running yet */
    } finally {
      setLoadingConvos(false);
    }
  };

  // ── Load messages for a conversation ────────────────────────────────────────
  const loadConversation = useCallback(async (id: string) => {
    if (isStreaming) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/${id}`);
      const json = await res.json();
      if (json.success) {
        const msgs = (json.data?.conversation?.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }));
        setMessages(msgs);
        setActiveConvoId(id);
      }
    } catch {
      setError("Failed to load conversation.");
    }
  }, [isStreaming]);

  // ── Delete conversation ──────────────────────────────────────────────────────
  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConvoId === id) {
        setActiveConvoId(null);
        setMessages([]);
      }
    } catch {
      setError("Failed to delete conversation.");
    }
  };

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setError(null);
    setInput("");

    // ① If no active conversation, create one first
    let convoId = activeConvoId;
    if (!convoId) {
      try {
        const res = await fetch(API_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Failed to create conversation");
        convoId = json.data.conversation.id;
        const newConvo: Conversation = {
          id: convoId!,
          title: trimmed.length > 55 ? trimmed.slice(0, 52) + "..." : trimmed,
          updatedAt: new Date().toISOString(),
        };
        setConversations(prev => [newConvo, ...prev]);
        setActiveConvoId(convoId);
      } catch (err: any) {
        setError(err.message || "Failed to create conversation.");
        return;
      }
    }

    // ② Append user message
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages(prev => [...prev, userMsg]);

    // ③ Show thinking indicator, then start SSE stream
    setIsThinking(true);
    setIsStreaming(true);

    streamingContentRef.current = "";
    let firstChunk = true;

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/${convoId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines (\n\n)
        const eventBlocks = buffer.split("\n\n");
        // Last element may be incomplete — keep it in the buffer
        buffer = eventBlocks.pop() ?? "";

        for (const block of eventBlocks) {
          const dataLine = block.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          const raw = dataLine.slice(6).trim();
          if (!raw) continue;

          let event: any;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === "chunk") {
            streamingContentRef.current += event.content;
            if (firstChunk) {
              // First chunk: trigger one React render to mount the streaming bubble
              firstChunk = false;
              setIsThinking(false);
            } else {
              // Subsequent chunks: write directly to DOM, zero React involvement
              if (streamingBubbleRef.current) {
                streamingBubbleRef.current.innerHTML = renderMarkdown(streamingContentRef.current);
              }
            }

          } else if (event.type === "done") {
            // Stream finished — commit full content to React state, clear the live bubble
            const fullContent = streamingContentRef.current;
            streamingContentRef.current = "";
            setMessages(prev => [
              ...prev,
              { id: crypto.randomUUID(), role: "assistant", content: fullContent },
            ]);
            fetchConversations();

          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Stream failed. Is the backend running?");
        streamingContentRef.current = "";
      }
    } finally {
      setIsThinking(false);
      setIsStreaming(false);
    }
  };

  // ── Submit handlers ──────────────────────────────────────────────────────────
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const activeConvo = conversations.find(c => c.id === activeConvoId);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">⚡</div>
            <div>
              <div className="brand-name">BIZOACH</div>
              <div className="brand-sub">AI Advisor</div>
            </div>
          </div>
          <button
            className="new-chat-btn"
            onClick={() => {
              setActiveConvoId(null);
              setMessages([]);
              setError(null);
              textareaRef.current?.focus();
            }}
            disabled={isStreaming}
          >
            <IconPlus />
            New Conversation
          </button>
        </div>

        {conversations.length > 0 && (
          <div className="sidebar-section-label">Recent</div>
        )}

        <div className="conversations-list">
          {loadingConvos ? (
            <div className="sidebar-empty">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="sidebar-empty">
              No conversations yet.<br />Ask the Advisor anything.
            </div>
          ) : (
            conversations.map(c => (
              <div
                key={c.id}
                className={`convo-item ${c.id === activeConvoId ? "active" : ""}`}
                onClick={() => loadConversation(c.id)}
              >
                <button
                  className="convo-delete-btn"
                  onClick={e => deleteConversation(e, c.id)}
                  title="Delete"
                >
                  <IconTrash />
                </button>
                <div className="convo-title">{c.title}</div>
                <div className="convo-date">{formatDate(c.updatedAt)}</div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Chat Area ── */}
      <main className="chat-area">

        {/* Header (only when conversation is active) */}
        {activeConvo && (
          <header className="chat-header">
            <span className="chat-header-title">{activeConvo.title}</span>
            <span className="advisor-badge">Advisor</span>
          </header>
        )}

        {/* Messages / Welcome */}
        {messages.length === 0 && !isThinking ? (
          <div className="welcome-screen">
            <div className="welcome-orb">⚡</div>
            <h1 className="welcome-title">BIZOACH Advisor</h1>
            <p className="welcome-subtitle">
              Your AI entrepreneurship coach. Ask about strategy, marketing,
              execution, mindset, or anything that helps you build a structured,
              scalable business.
            </p>
            <div className="welcome-prompts">
              {PROMPT_CHIPS.map(chip => (
                <button
                  key={chip}
                  className="prompt-chip"
                  onClick={() => sendMessage(chip)}
                  disabled={isStreaming}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages-container">
            <div className="messages-inner">
              {messages.map(msg => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <span className="message-role">
                    {msg.role === "user" ? "You" : "Advisor"}
                  </span>
                  <div
                    className="message-bubble markdown-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                </div>
              ))}

              {isThinking && (
                <div className="message assistant">
                  <span className="message-role">Advisor</span>
                  <div className="thinking-bubble">
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                  </div>
                </div>
              )}

              {/* Live streaming bubble — content written directly to DOM via ref */}
              {isStreaming && !isThinking && (
                <div className="message assistant">
                  <span className="message-role">Advisor</span>
                  <div className="message-bubble markdown-body">
                    <span ref={streamingBubbleRef}></span>
                    <span className="streaming-cursor" />
                  </div>
                </div>
              )}

              {error && (
                <div className="error-toast">⚠ {error}</div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="input-bar">
          {error && messages.length === 0 && (
            <div className="error-toast">⚠ {error}</div>
          )}
          <div className="input-inner">
            <form className="input-form" onSubmit={handleSubmit}>
              <textarea
                ref={textareaRef}
                className="input-textarea"
                placeholder="Ask the Advisor anything about your business..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isStreaming}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={!input.trim() || isStreaming}
                title="Send (Enter)"
              >
                <IconSend />
              </button>
            </form>
            <p className="input-hint">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>

      </main>
    </div>
  );
}
