import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Bot,
  Sparkles,
  User,
  AlertCircle,
  TrendingUp,
  Award,
  ShieldCheck,
  Activity,
  Calculator,
  Compass,
  RotateCcw,
  Sun,
  Calendar,
  KeyRound,
} from 'lucide-react';

import { useTrading } from '../context/TradingContext';

interface ChatMessage {
  sender: 'ai' | 'user';
  text: string;
  time: string;
  image?: string;
}

type TemplateCategory = 'analysis' | 'macro' | 'trends' | 'risk';

export const AiAssistant: React.FC = () => {
  const {
    selectedSymbol: symbol,
    selectedTimeframe: timeframe,
    activeSignal,
    aiSnapshot: attachedImage,
    onClearAttachedImage,
  } = useTrading();

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Initial greeting only once on mount
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return [
      {
        sender: 'ai',
        text: `Greetings! I am the **ApexFX AI Analyst**. Ask me anything about technical analysis, confluence, or risk.\n\nUse **Strategy Templates** below for quick scans. Chart snapshots can be attached for visual analysis.\n\n> **Disclaimer:** Win rates / profit factors shown in the terminal are heuristic estimates, not backtested results, and not financial advice.`,
        time: now,
      },
    ];
  });

  const [inputText, setInputText] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('analysis');
  const [geminiKey, setGeminiKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('apexfx_gemini_api_key') || '' : '';
  });
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [keyInput, setKeyInput] = useState<string>('');
  const [serverAiConfigured, setServerAiConfigured] = useState<boolean>(false);

  // Check if server already has GEMINI_API_KEY set
  useEffect(() => {
    fetch('/api/ai/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.configured) {
          setServerAiConfigured(true);
        }
      })
      .catch(() => {});
  }, []);

  const bottomRef = useRef<HTMLDivElement>(null);
  const hasInitializedContextRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Update greeting with live context only once, without wiping history
  useEffect(() => {
    if (hasInitializedContextRef.current) return;
    if (!activeSignal) return;
    hasInitializedContextRef.current = true;
    setMessages((prev) => {
      if (prev.length > 1) return prev; // Don't overwrite if user already chatted
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return [
        {
          sender: 'ai',
          text: `Greetings! I am the **ApexFX AI Analyst**. I have scanned **${symbol}** on **${timeframe}** — current consensus: **${activeSignal.type}** (${activeSignal.confidence}% at ${activeSignal.price}). 📊\n\nUse **Expert Strategy Templates** below or ask any technical question. You can also attach a chart snapshot for visual analysis.\n\n> **Note:** Pattern win rates are heuristic estimates, not backtested guarantees.`,
          time: now,
        },
      ];
    });
  }, [symbol, timeframe, activeSignal]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleNewChat = useCallback(() => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages([
      {
        sender: 'ai',
        text: `New session started for **${symbol}** (${timeframe}). How can I help?`,
        time: now,
      },
    ]);
    onClearAttachedImage?.();
  }, [symbol, timeframe, onClearAttachedImage]);

  const handleSendMessage = async (textToSend = inputText, imageToSend: string | null = attachedImage) => {
    if (isTyping) return; // prevent double-send
    if (!textToSend.trim() && !imageToSend) return;

    const userMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      sender: 'user',
      text: textToSend || 'Please analyze this chart snapshot.',
      time: userMsgTime,
      ...(imageToSend ? { image: imageToSend } : {}),
    };

    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    setInputText('');
    onClearAttachedImage?.();
    setIsTyping(true);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (geminiKey.trim()) {
        headers['x-gemini-api-key'] = geminiKey.trim();
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ sender: m.sender, text: m.text, image: m.image })),
          selectedSymbol: symbol,
          selectedTimeframe: timeframe,
          activeSignal,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const resData = await response.json().catch(() => ({}));
      if (!response.ok || resData.error) {
        throw new Error(resData.error || `AI request failed (HTTP ${response.status})`);
      }

      const aiMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [...prev, { sender: 'ai', text: resData.text, time: aiMsgTime }]);
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'Request timed out' : err?.message || 'AI service unavailable';
      const aiMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        { sender: 'ai', text: `⚠️ **Live AI service error**: ${reason}`, time: aiMsgTime },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full relative" id="ai_assistant_component">
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">AI Co-Pilot Strategist</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setKeyInput(geminiKey);
              setShowKeyModal(true);
            }}
            title={
              geminiKey
                ? 'Client Gemini API Key configured'
                : serverAiConfigured
                ? 'Server Gemini API Key active (click to override)'
                : 'Configure Google Gemini API Key'
            }
            className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1.5 transition-all border cursor-pointer ${
              geminiKey || serverAiConfigured
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30 hover:bg-emerald-900/60'
                : 'bg-amber-950/40 text-amber-300 border-amber-500/40 hover:bg-amber-900/40'
            }`}
          >
            <KeyRound className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">
              {geminiKey ? 'Gemini Custom' : serverAiConfigured ? 'Gemini Live' : 'Set Gemini Key'}
            </span>
          </button>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Context: {symbol} ({timeframe})</span>
          </div>
          <button
            onClick={handleNewChat}
            title="Start new chat"
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 min-h-[200px] max-h-[320px]">
        {messages.map((msg, idx) => {
          const isAi = msg.sender === 'ai';
          return (
            <div key={idx} className={`flex gap-2.5 max-w-[90%] ${isAi ? 'mr-auto' : 'ml-auto flex-row-reverse text-right'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white ${isAi ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                {isAi ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
              </div>
              <div className="space-y-1">
                {msg.image && (
                  <div className="mb-1.5 overflow-hidden rounded-lg border border-zinc-800 max-w-[240px] ml-auto">
                    <img src={msg.image} alt="Chart Snapshot" className="w-full h-auto object-cover rounded-lg" referrerPolicy="no-referrer" />
                  </div>
                )}
                <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${isAi ? 'bg-zinc-900 text-zinc-200 rounded-tl-none' : 'bg-blue-950/40 text-blue-100 border border-blue-900/40 rounded-tr-none'}`}>
                  {msg.text.split('\n').map((line, lineIdx) => {
                    if (line.startsWith('### ')) {
                      return <h3 key={lineIdx} className="font-bold text-emerald-400 text-xs mt-2.5 mb-1.5 uppercase font-display tracking-wider">{line.replace('### ', '')}</h3>;
                    }
                    if (line.startsWith('#### ')) {
                      return <h4 key={lineIdx} className="font-semibold text-zinc-300 text-[11px] mt-2 mb-1 uppercase font-mono tracking-wide">{line.replace('#### ', '')}</h4>;
                    }
                    // Render inline markdown in a single pass: **bold** and `code`
                    const parts: React.ReactNode[] = [];
                    const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
                    tokens.forEach((tok, i) => {
                      if (tok.startsWith('**') && tok.endsWith('**')) {
                        parts.push(<strong key={i} className="font-bold text-white">{tok.slice(2, -2)}</strong>);
                      } else if (tok.startsWith('`') && tok.endsWith('`')) {
                        parts.push(<code key={i} className="bg-zinc-950 border border-zinc-800 text-emerald-400 px-1.5 py-0.5 rounded font-mono text-[10px]">{tok.slice(1, -1)}</code>);
                      } else if (tok) {
                        parts.push(<React.Fragment key={i}>{tok}</React.Fragment>);
                      }
                    });
                    return (
                      <p key={lineIdx} className={lineIdx > 0 ? 'mt-1.5' : ''}>
                        {parts.length > 0 ? parts : '\u00A0'}
                      </p>
                    );
                  })}
                </div>
                <div className="text-[9px] text-zinc-500 font-mono tracking-tighter px-1">{msg.time}</div>
              </div>
            </div>
          );
        })}
        {isTyping && (
          <div className="flex gap-2.5 max-w-[80%] mr-auto items-center text-zinc-500">
            <div className="w-6 h-6 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 animate-bounce" />
            </div>
            <div className="bg-zinc-900 px-3 py-2 rounded-lg text-[10px] font-mono tracking-widest uppercase animate-pulse">AI Is Thinking...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="bg-zinc-900/40 border-t border-zinc-800/80 p-3">
        <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-zinc-800/40">
          <div className="flex items-center gap-1 text-[10px] uppercase font-mono font-bold text-zinc-400">
            <Compass className="w-3.5 h-3.5 text-emerald-500" />
            <span>AI Strategy Templates</span>
          </div>
          <div className="flex bg-zinc-950 p-0.5 rounded border border-zinc-800 font-mono text-[9px]">
            <button onClick={() => setActiveCategory('analysis')} className={`px-1.5 py-0.5 rounded cursor-pointer ${activeCategory === 'analysis' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'}`}>Analysis</button>
            <button onClick={() => setActiveCategory('macro')} className={`px-1.5 py-0.5 rounded cursor-pointer ${activeCategory === 'macro' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'}`}>Macro</button>
            <button onClick={() => setActiveCategory('trends')} className={`px-1.5 py-0.5 rounded cursor-pointer ${activeCategory === 'trends' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'}`}>Indicators</button>
            <button onClick={() => setActiveCategory('risk')} className={`px-1.5 py-0.5 rounded cursor-pointer ${activeCategory === 'risk' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'}`}>Risk</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 max-h-[105px] overflow-y-auto scrollbar-thin">
          {activeCategory === 'macro' && (
            <>
              <button disabled={isTyping} onClick={() => handleSendMessage("Generate a complete Daily Macro Morning Briefing: evaluate today's ForexFactory economic releases, 8-currency strength hierarchy, and highest-confluence pairs for today.")} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group disabled:opacity-50 disabled:cursor-not-allowed">
                <div className="flex items-center gap-1.5 mb-1"><Sun className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">Daily Morning Brief</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">ForexFactory releases + Currency Strength ranking.</p>
              </button>
              <button disabled={isTyping} onClick={() => handleSendMessage('Check upcoming high-impact economic news releases for this active instrument and provide a defensive risk-management playbook.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><Calendar className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">Pre-News Playbook</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">Volatility risk and spread mitigation plan.</p>
              </button>
            </>
          )}
          {activeCategory === 'analysis' && (
            <>
              <button disabled={isTyping} onClick={() => handleSendMessage('Run a multi-indicator confluence check to find matching confirmation signals. Note that win rates are heuristic estimates.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group disabled:opacity-50 disabled:cursor-not-allowed">
                <div className="flex items-center gap-1.5 mb-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">Indicator Confluence</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">Combine RSI, EMA50 & SMA20 strategy.</p>
              </button>
              <button disabled={isTyping} onClick={() => handleSendMessage('Calculate Fibonacci retracement levels from the highest peaks and lowest troughs.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><TrendingUp className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">Fibonacci Grid</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">Extract mathematical golden-ratio supports.</p>
              </button>
            </>
          )}
          {activeCategory === 'trends' && (
            <>
              <button disabled={isTyping} onClick={() => handleSendMessage('Analyze current Moving Average Crossovers (SMA 20 vs EMA 50) for entry alignment.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><Activity className="w-3.5 h-3.5 text-yellow-500 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">EMA/SMA Crossover</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">Flag Golden and Death crossovers instantly.</p>
              </button>
              <button disabled={isTyping} onClick={() => handleSendMessage('Assess market volatility via ATR (Average True Range) to gauge current trading risk levels.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><AlertCircle className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">ATR Volatility Scan</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">Audit current pip range standard volatility.</p>
              </button>
            </>
          )}
          {activeCategory === 'risk' && (
            <>
              <button disabled={isTyping} onClick={() => handleSendMessage('Scan for the most profitable candlestick patterns in the active history. Remind that win rates are heuristic estimates, not backtested guarantees.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><Award className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">High Probability Scan</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">List the scanned candlestick shapes.</p>
              </button>
              <button disabled={isTyping} onClick={() => handleSendMessage('Calculate recommended lot size and risk-reward ratio assuming a 1% risk on a $10,000 account.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><Calculator className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">1% Lot Size Calculator</span></div>
                <p className="text-[9px] text-zinc-500 leading-tight">Forex mathematics & risk control guide.</p>
              </button>
            </>
          )}
        </div>
      </div>

      {attachedImage && (
        <div className="px-3 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded border border-zinc-700 overflow-hidden bg-zinc-950 shrink-0">
              <img src={attachedImage} alt="Pending snapshot" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Chart Snapshot Attached</span>
              <span className="text-[9px] text-zinc-500 font-mono">Ready to be analyzed by Co-Pilot</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 font-sans">
            <button type="button" disabled={isTyping} onClick={() => handleSendMessage('Please run a full visual candle chart analysis on this snapshot.', attachedImage)} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-mono font-bold transition-all cursor-pointer shadow disabled:opacity-50 disabled:cursor-not-allowed">Analyze Snapshot</button>
            <button type="button" onClick={onClearAttachedImage} className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-rose-400 rounded transition-colors cursor-pointer" title="Remove snapshot">✕</button>
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="p-3 bg-zinc-900 border-t border-zinc-800 flex gap-2">
        <input type="text" disabled={isTyping} placeholder={isTyping ? 'AI is thinking…' : 'Ask AI Analyst (e.g. \"RSI check\", \"Support lines\")...'} value={inputText} onChange={(e) => setInputText(e.target.value)} className="flex-1 bg-zinc-950 text-xs border border-zinc-800 focus:border-zinc-700 outline-none rounded-lg px-3 py-2 text-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed" />
        <button type="submit" disabled={isTyping} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3.5 py-2 transition-all flex items-center justify-center cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
      </form>

      {/* Gemini API Key Configuration Modal Overlay */}
      {showKeyModal && (
        <div className="absolute inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm p-4 flex flex-col justify-center items-center">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 w-full max-w-sm space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h3 className="font-display font-semibold text-xs text-zinc-100 tracking-wide">Google Gemini AI Configuration</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded"
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              ApexFX AI Co-Pilot uses <strong className="text-zinc-200">Google Gemini 2.5 Flash</strong> with multimodal chart vision.
              {serverAiConfigured ? (
                <span className="block mt-1 text-emerald-400 font-mono text-[10px]">
                  ✓ Default server GEMINI_API_KEY is currently connected. You may provide a custom key below to override it.
                </span>
              ) : (
                <span className="block mt-1 text-zinc-400 text-[10px]">
                  Provide your Gemini API key to activate instant AI chart analysis and macro briefings. Keys remain securely on your client.
                </span>
              )}
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] text-zinc-400 uppercase font-mono font-bold tracking-wider">
                Gemini API Key
              </label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-mono flex items-center gap-1"
              >
                Get free key at AI Studio ↗
              </a>
              <div className="flex gap-2 font-mono">
                {geminiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('apexfx_gemini_api_key');
                      setGeminiKey('');
                      setKeyInput('');
                      setShowKeyModal(false);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-rose-400 text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = keyInput.trim();
                    if (trimmed) {
                      localStorage.setItem('apexfx_gemini_api_key', trimmed);
                      setGeminiKey(trimmed);
                    }
                    setShowKeyModal(false);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors cursor-pointer shadow-lg shadow-emerald-950/40"
                >
                  Save Key
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
