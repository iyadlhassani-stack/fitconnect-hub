import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { useSendChatMessage, useGenerateCheckin } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, Sun, Coffee, Sunset, Moon } from "lucide-react";
import { format } from "date-fns";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 max-w-[80%]">
      <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "linear-gradient(135deg, #6C5CE7, #8B7CF8)" }} />
      <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CoachPage() {
  const { t } = useTranslation();
  const profile = useAppStore((s) => s.profile);
  const storeMessages = useAppStore((s) => s.messages);
  const setMessages = useAppStore((s) => s.setMessages);
  const addMessage = useAppStore((s) => s.addMessage);

  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendChat = useSendChatMessage();
  const generateCheckin = useGenerateCheckin();

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("coach_messages")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (data && data.length > 0) setMessages(data as Message[]);
      });
  }, [profile?.id, setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [storeMessages, isTyping]);

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    if (!profile?.id) return;
    const { data } = await supabase.from("coach_messages").insert({
      user_id: profile.id,
      role,
      content,
      type: "chat",
      read: role === "user",
      created_at: new Date().toISOString(),
    }).select().single();
    return data;
  };

  const sendMessage = async () => {
    if (!input.trim() || !profile) return;
    const userContent = input.trim();
    setInput("");

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: userContent,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);
    await saveMessage("user", userContent);

    setIsTyping(true);
    try {
      const conversationHistory = [...storeMessages, userMsg].slice(-20).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const resp = await sendChat.mutateAsync({
        data: {
          messages: conversationHistory,
          userProfile: {
            name: profile.full_name ?? "User",
            goal: profile.goal ?? "health",
            weight_kg: profile.weight_kg ?? null,
            daily_calorie_target: profile.daily_calorie_target ?? null,
            daily_protein_target: profile.daily_protein_target ?? null,
            diet: null,
            language: profile.language ?? "en",
          },
        },
      });

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: resp.content,
        created_at: new Date().toISOString(),
      };
      addMessage(aiMsg);
      await saveMessage("assistant", resp.content);
    } catch {
      addMessage({
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I'm having trouble connecting. Please try again.",
        created_at: new Date().toISOString(),
      });
    } finally {
      setIsTyping(false);
    }
  };

  const triggerCheckin = async (slot: "morning" | "lunch" | "evening" | "night") => {
    if (!profile) return;
    setIsTyping(true);
    try {
      const resp = await generateCheckin.mutateAsync({
        data: {
          slot,
          userProfile: {
            name: profile.full_name ?? "User",
            goal: profile.goal ?? "health",
            weight_kg: profile.weight_kg ?? null,
            daily_calorie_target: profile.daily_calorie_target ?? null,
            daily_protein_target: profile.daily_protein_target ?? null,
            diet: null,
            language: profile.language ?? "en",
          },
          todayStats: undefined,
        },
      });
      const aiMsg: Message = {
        id: `checkin-${Date.now()}`,
        role: "assistant",
        content: resp.content,
        created_at: new Date().toISOString(),
      };
      addMessage(aiMsg);
      await saveMessage("assistant", resp.content);
    } finally {
      setIsTyping(false);
    }
  };

  const checkins = [
    { slot: "morning" as const, label: t("coach.check_in_morning"), Icon: Sun, color: "#FF6B35" },
    { slot: "lunch" as const, label: t("coach.check_in_lunch"), Icon: Coffee, color: "#00C853" },
    { slot: "evening" as const, label: t("coach.check_in_evening"), Icon: Sunset, color: "#6C5CE7" },
    { slot: "night" as const, label: t("coach.check_in_night"), Icon: Moon, color: "#00B8D4" },
  ];

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)] max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6C5CE7, #8B7CF8)" }}>
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="font-bold text-foreground text-sm">FitCoach</p>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <p className="text-xs text-muted-foreground">{t("coach.online")}</p>
          </div>
        </div>
      </div>

      {/* Check-in buttons */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-border bg-background flex-shrink-0 scrollbar-hide">
        {checkins.map(({ slot, label, Icon, color }) => (
          <button
            key={slot}
            data-testid={`button-checkin-${slot}`}
            onClick={() => triggerCheckin(slot)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-xs font-semibold whitespace-nowrap flex-shrink-0 active:scale-95 transition-transform"
          >
            <Icon className="w-3.5 h-3.5" style={{ color }} />
            {label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {storeMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6C5CE7, #8B7CF8)" }}>
              <Bot className="w-9 h-9 text-white" />
            </div>
            <div>
              <p className="font-bold text-foreground">Your AI coach is ready!</p>
              <p className="text-sm text-muted-foreground mt-1">Ask anything about your fitness journey or trigger a check-in above.</p>
            </div>
          </div>
        )}

        {(storeMessages as Message[]).map((msg) => (
          <div
            key={msg.id}
            data-testid={`message-${msg.role}`}
            className={`flex items-end gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"} max-w-[85%] ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6C5CE7, #8B7CF8)" }}>
                <Bot className="w-4 h-4 text-white" />
              </div>
            )}
            <div className={`px-4 py-3 rounded-2xl min-w-0 ${msg.role === "user" ? "bg-primary text-white rounded-br-sm" : "bg-card border border-border text-foreground rounded-bl-sm"}`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words overflow-wrap-anywhere">{msg.content}</p>
              <p className={`text-xs mt-1 ${msg.role === "user" ? "text-white/60" : "text-muted-foreground"}`}>
                {format(new Date(msg.created_at), "HH:mm")}
              </p>
            </div>
          </div>
        ))}

        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Disclaimer */}
      <p className="text-center text-xs text-muted-foreground px-4 py-1 flex-shrink-0">{t("coach.disclaimer")}</p>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border bg-card flex-shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            data-testid="input-message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Message your coach..."
            className="resize-none rounded-xl min-h-[44px] max-h-28 py-3"
            rows={1}
          />
          <Button
            data-testid="button-send"
            onClick={sendMessage}
            disabled={!input.trim() || sendChat.isPending}
            className="rounded-xl h-11 w-11 p-0 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
