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
} from 'lucide-react';

import { boundedChatMessages, CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_IMAGE_BYTES } from '../../shared/chat';
import { useTrading } from '../context/TradingContext';

interface ChatMessage {
  sender: 'ai' | 'user';
  text: string;
  time: string;
  image?: string;
}

type TemplateCategory = 'analysis' | 'trends' | 'risk';

export const AiAssistant: React.FC = () => {
  const {
    selectedSymbol: symbol,
    selectedTimeframe: timeframe,
    activeSignal,
    aiSnapshot: attachedImage,
    onClearAttachedImage,
    account,
  } = useTrading();

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Initial greeting only once on mount
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return [
      {
        sender: 'ai',
        text: `Greetings! I am the **ApexFX AI Analyst**. Ask me anything about technical analysis, confluence, or risk.\n\nUse **Strategy Templates** below for quick scans. Chart snapshots can be attached for visual analysis.\n\n> **Disclaimer:** Pattern scores are unvalidated heuristics, not win probabilities. Ledger statistics describe paper results, not future returns.`,
        time: now,
      },
    ];
  });

  const [inputText, setInputText] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('analysis');
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasInitializedContextRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const publish = useCallback((action: React.SetStateAction<ChatMessage[]>) => {
    const next = typeof action === 'function' ? action(messagesRef.current) : action;
    messagesRef.current = next.slice(-40); setMessages(messagesRef.current);
  }, []);
  const cancel = useCallback(() => {
    generation.current++; pending.current?.abort(); pending.current = null;
  }, []);
  useEffect(() => {
    cancel(); setIsTyping(false); setInputText('');
    publish([{ sender: 'ai', text: 'Educational assistant. Sign in to use paid AI unless the operator explicitly enables capped guest access. Conversation context is limited to 12 messages / 12,000 characters; old images are not resent.', time: new Date().toLocaleTimeString() }]);
    onClearAttachedImage();
    return cancel;
  }, [account.owner, cancel, publish, onClearAttachedImage]);

  // Update greeting with live context only once, without wiping history
  useEffect(() => {
    if (hasInitializedContextRef.current) return;
    if (!activeSignal) return;
    hasInitializedContextRef.current = true;
    publish((prev) => {
      if (prev.length > 1) return prev; // Don't overwrite if user already chatted
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return [
        {
          sender: 'ai',
          text: `Greetings! I am the **ApexFX AI Analyst**. Displayed heuristic for **${symbol}** on **${timeframe}** — current consensus: **${activeSignal.type}** (${activeSignal.confidence}/100 at ${activeSignal.price}). 📊\n\nUse **Expert Strategy Templates** below or ask any technical question. You can also attach a chart snapshot for visual analysis.\n\n> **Note:** Pattern scores are not win probabilities or validated forecasts.`,
          time: now,
        },
      ];
    });
  }, [symbol, timeframe, activeSignal, publish]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleNewChat = useCallback(() => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    cancel(); setIsTyping(false);
    publish([
      {
        sender: 'ai',
        text: `New session started for **${symbol}** (${timeframe}). How can I help?`,
        time: now,
      },
    ]);
    onClearAttachedImage?.();
  }, [symbol, timeframe, onClearAttachedImage, cancel, publish]);

  const handleSendMessage = async (textToSend = inputText, imageToSend: string | null = attachedImage) => {
    if (pending.current) return; // synchronous latch: double clicks before render are also blocked
    if (!textToSend.trim() && !imageToSend) return;

    const userMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      sender: 'user',
      text: textToSend || 'Please analyze this chart snapshot.',
      time: userMsgTime,
      ...(imageToSend ? { image: imageToSend } : {}),
    };

    if (textToSend.length > CHAT_MAX_MESSAGE_CHARS || (imageToSend && imageToSend.length * .75 > CHAT_MAX_IMAGE_BYTES + 32)) {
      publish(prev => [...prev, { sender: 'ai', text: 'Message or snapshot too large. Use at most 4,000 characters and a smaller chart snapshot (256 KB).', time: userMsgTime }]);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const epoch = generation.current;
    const updatedMessages = [...messagesRef.current, userMsg];
    publish(updatedMessages); setInputText(''); onClearAttachedImage(); setIsTyping(true);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const current = () => generation.current === epoch && pending.current === controller;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(account.session?.access_token ? { Authorization: `Bearer ${account.session.access_token}` } : {}) },
        body: JSON.stringify({ messages: boundedChatMessages(updatedMessages), selectedSymbol: symbol, selectedTimeframe: timeframe }), signal: controller.signal,
      });
      const result = await response.json();
      if (!current()) return;
      if (controller.signal.aborted) throw new Error('Request timed out.');
      if (!response.ok || typeof result.text !== 'string') throw new Error(result.error || `AI request failed (${response.status})`);
      publish(prev => [...prev, { sender: 'ai', text: result.text.slice(0, 8000), time: new Date().toLocaleTimeString() }]);
    } catch (error) {
      if (current()) publish(prev => [...prev, { sender: 'ai', text: `AI service: ${controller.signal.aborted ? 'Request timed out.' : error instanceof Error ? error.message : 'Unavailable.'}`, time: new Date().toLocaleTimeString() }]);
    } finally {
      clearTimeout(timeout);
      if (current()) { pending.current = null; setIsTyping(false); }
    }
  };

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full" id="ai_assistant_component">
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">AI Co-Pilot Strategist</h2>
        </div>
        <div className="flex items-center gap-2">
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
            <button onClick={() => setActiveCategory('trends')} className={`px-1.5 py-0.5 rounded cursor-pointer ${activeCategory === 'trends' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'}`}>Indicators</button>
            <button onClick={() => setActiveCategory('risk')} className={`px-1.5 py-0.5 rounded cursor-pointer ${activeCategory === 'risk' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'}`}>Risk</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 max-h-[105px] overflow-y-auto scrollbar-thin">
          {activeCategory === 'analysis' && (
            <>
              <button disabled={isTyping} onClick={() => handleSendMessage('Run a multi-indicator confluence check to find matching confirmation signals. Explain that confluence scores are not probabilities.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group disabled:opacity-50 disabled:cursor-not-allowed">
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
              <button disabled={isTyping} onClick={() => handleSendMessage('Explain candle-pattern confluence. Do not claim to see history not provided, or invent win probabilities.')} className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group">
                <div className="flex items-center gap-1.5 mb-1"><Award className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" /><span className="text-[10px] font-bold text-zinc-200">Confluence Scan</span></div>
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
        <input type="text" aria-label="Message to AI assistant" maxLength={CHAT_MAX_MESSAGE_CHARS} disabled={isTyping} placeholder={isTyping ? 'AI is thinking…' : 'Ask AI Analyst (e.g. "RSI check", "Support lines")...'} value={inputText} onChange={(e) => setInputText(e.target.value)} className="flex-1 bg-zinc-950 text-xs border border-zinc-800 focus:border-zinc-700 outline-none rounded-lg px-3 py-2 text-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed" />
        <button type="submit" aria-label="Send message" disabled={isTyping} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3.5 py-2 transition-all flex items-center justify-center cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
      </form>
    </div>
  );
};
