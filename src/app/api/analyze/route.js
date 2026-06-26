import { NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are an expert English fluency coach. Analyze the given speech transcript and return ONLY a valid JSON object — no markdown, no code fences, no explanation.

JSON schema:
{
  "overall_score": <integer 1-10>,
  "wpm": <integer, estimated words per minute>,
  "fluency_score": <integer 1-10>,
  "grammar_score": <integer 1-10>,
  "vocabulary_score": <integer 1-10>,
  "clarity_score": <integer 1-10>,
  "filler_words": {
    "count": <integer>,
    "list": [<string>]
  },
  "grammar_corrections": [
    { "original": <string>, "corrected": <string>, "explanation": <string> }
  ],
  "strengths": [<string>, <string>],
  "improvements": [<string>, <string>],
  "verdict": <one sentence overall assessment>
}`;

export async function POST(request) {
  try {
    const { transcript, durationSeconds } = await request.json();

    if (!transcript || transcript.trim().length < 5) {
      return NextResponse.json({ error: "Transcript too short" }, { status: 400 });
    }

    const wordCount = transcript.trim().split(/\s+/).length;
    const estimatedWPM = durationSeconds
      ? Math.round((wordCount / durationSeconds) * 60)
      : Math.round(wordCount / 0.5);

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Transcript (approx ${durationSeconds || 30}s of speech, ${wordCount} words):\n\n"${transcript}"\n\nEstimated WPM: ${estimatedWPM}`,
        },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    const json = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return NextResponse.json(json);
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: error.message || "Analysis failed" },
      { status: 500 }
    );
  }
}
