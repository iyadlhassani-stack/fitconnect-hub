import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import {
  SendChatMessageBody,
  EstimateMacrosBody,
  GenerateCheckinBody,
} from "@workspace/api-zod";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post("/ai/chat", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { messages, userProfile } = parsed.data;
  const { name, goal, weight_kg, daily_calorie_target, daily_protein_target, diet, language } = userProfile;

  const lang = language === "fr" ? "French" : "English";
  const pronoun = language === "fr" ? "Use 'tu' (informal) in French." : "";

  const systemPrompt = `You are a personal fitness and nutrition coach for ${name}. 
Their goal is: ${goal}. 
Current weight: ${weight_kg ?? "unknown"} kg.
Daily calorie target: ${daily_calorie_target ?? "not set"} kcal.
Daily protein target: ${daily_protein_target ?? "not set"} g.
Diet preference: ${diet ?? "standard"}.
Always respond in ${lang}. ${pronoun}
Be warm, motivating, direct, and practical. Use their conversation history to remember context.
When they share what they ate, help estimate macros and encourage logging. 
When they share a workout, congratulate them and suggest next steps.
Keep responses concise and actionable (2-4 sentences max unless they ask for more detail).
Add a disclaimer at the end: "AI suggestions are not medical advice" (in the appropriate language).`;

  try {
    const anthropicMessages = (messages as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const content = response.content[0];
    if (content.type !== "text") {
      res.status(500).json({ error: "Unexpected response type" });
      return;
    }

    res.json({ content: content.text });
  } catch (err) {
    req.log.error({ err }, "Claude API error");
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

router.post("/ai/estimate-macros", async (req, res): Promise<void> => {
  const parsed = EstimateMacrosBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { description, language } = parsed.data;
  const lang = language === "fr" ? "French" : "English";

  const systemPrompt = `You are a nutrition expert. Estimate the macronutrients for meals described by users.
Always respond in ${lang}. 
Return ONLY a valid JSON object with these fields: name (string), calories (integer), protein (number), carbs (number), fat (number), confidence ("high"|"medium"|"low").
Do not include any explanation, just the JSON object.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: `Estimate macros for: ${description}` }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      res.status(500).json({ error: "Unexpected response type" });
      return;
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Could not parse macro estimate" });
      return;
    }

    const estimate = JSON.parse(jsonMatch[0]);
    res.json(estimate);
  } catch (err) {
    req.log.error({ err }, "Macro estimation error");
    res.status(500).json({ error: "Failed to estimate macros" });
  }
});

router.post("/ai/checkin", async (req, res): Promise<void> => {
  const parsed = GenerateCheckinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { slot, userProfile, todayStats } = parsed.data;
  const { name, language } = userProfile;
  const lang = language === "fr" ? "French" : "English";
  const pronoun = language === "fr" ? "Use 'tu' (informal) in French." : "";

  const slotPrompts: Record<string, string> = {
    morning: "It's morning check-in time (8 AM). Ask how they slept and what their plan is for the day. Be energizing.",
    lunch: "It's lunch check-in time (1 PM). Ask what they had for lunch and how they're feeling. Be warm and curious.",
    evening: "It's evening check-in time (6 PM). Ask if they got a workout in today and if they need motivation for an evening walk.",
    night: "It's night check-in time (9 PM). Do a quick wrap-up: how did the day go? Did they hit their protein target? Be gentle and reflective.",
  };

  const statsContext = todayStats
    ? `Today so far: ${todayStats.calories_consumed ?? 0} / ${todayStats.calories_target ?? "?"} kcal, ${todayStats.workouts_logged ?? 0} workouts logged.`
    : "";

  const systemPrompt = `You are a personal fitness coach for ${name}. ${slotPrompts[slot] ?? slotPrompts.morning}
${statsContext}
Respond in ${lang}. ${pronoun}
Keep it short, personal, and warm — 1-3 sentences max. Make it feel like a text from a friend who cares.
Do NOT add any disclaimer.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate a check-in message" }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      res.status(500).json({ error: "Unexpected response type" });
      return;
    }

    res.json({ content: content.text });
  } catch (err) {
    req.log.error({ err }, "Check-in generation error");
    res.status(500).json({ error: "Failed to generate check-in" });
  }
});

export default router;
