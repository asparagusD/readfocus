"""
LLM Services module.

Provider      | Agent(s)              | Free RPD  | Free TPM    | Context
--------------|-----------------------|-----------|-------------|--------
Groq          | Orchestrator          | 1,000     | 6,000       | 128K
Cerebras      | Planner, Optimizer    | ~33,000*  | 60,000      | 8K ⚠️
Google AI     | Test gen, Evaluator   | 1,500     | 1,000,000   | 1M
SambaNova     | Fallback (all)        | ~600**    | varies      | 128K

* Cerebras free tier is 1M tokens/day. At ~30 tokens/call average for
  planner/optimizer, this is ~33,000 effective calls/day.
** SambaNova RPD is approximate; used only on fallback so this rarely matters.

⚠️  Cerebras 8K context cap: ONLY use Cerebras for planner and optimizer.
    Never route test_llm or evaluator_llm through Cerebras — book chunks
    + RAG context + system prompt will exceed 8K tokens.
"""

import os
from langchain_openai import ChatOpenAI
# pyrefly: ignore [missing-import]
from langchain_google_genai import ChatGoogleGenerativeAI
from dotenv import load_dotenv

load_dotenv()

# Read API keys from environment variables
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")
GOOGLE_AI_STUDIO_KEY = os.getenv("GOOGLE_AI_STUDIO_KEY")
SAMBANOVA_API_KEY = os.getenv("SAMBANOVA_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing. Get it from https://console.groq.com")
if not CEREBRAS_API_KEY:
    raise ValueError("CEREBRAS_API_KEY is missing. Get it from https://cloud.cerebras.ai")
if not GOOGLE_AI_STUDIO_KEY:
    raise ValueError("GOOGLE_AI_STUDIO_KEY is missing. Get it from https://aistudio.google.com")
if not SAMBANOVA_API_KEY:
    raise ValueError("SAMBANOVA_API_KEY is missing. Get it from https://cloud.sambanova.ai")

# 1. Fallback for all agents — SambaNova
# Reason: SambaNova offers a persistent free tier (no credit card, no expiry) with Llama 3.3 70B. 
# It is used exclusively as a fallback when a primary provider returns a 429 or 503.
sambanova_llm = ChatOpenAI(
    model="Meta-Llama-3.3-70B-Instruct",
    openai_api_base="https://api.sambanova.ai/v1",
    openai_api_key=SAMBANOVA_API_KEY,
)

# 2. Orchestrator — Groq
# Reason: The orchestrator is called once per session start. Groq's LPU hardware means near-instant routing decisions. 1,000 RPD is sufficient.
orchestrator_llm = ChatOpenAI(
    model="llama-3.3-70b-versatile",
    openai_api_base="https://api.groq.com/openai/v1",
    openai_api_key=GROQ_API_KEY,
).with_fallbacks([sambanova_llm])

# 3. Session planner — Cerebras
# Reason: The planner sends short, structured prompts (session history + scoring trend). 
# Cerebras gives 1M tokens/day free. Prompts stay well under the 8K context cap on the free tier.
planner_llm = ChatOpenAI(
    model="gpt-oss-120b",
    openai_api_base="https://api.cerebras.ai/v1",
    openai_api_key=CEREBRAS_API_KEY,
).with_fallbacks([sambanova_llm])

# 4. Test generator — Google AI Studio (Gemini)
# Reason: The test generator receives a full book chunk (~600–900 words) plus RAG context. This easily exceeds 8K tokens. 
# Gemini 2.5 Flash has a 1M token context window even on the free tier, and 1,500 RPD.
test_llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=GOOGLE_AI_STUDIO_KEY,
    convert_system_message_to_human=True,
).with_fallbacks([sambanova_llm])

# 5. Answer evaluator — Google AI Studio (Gemini)
# Reason: The evaluator receives the chunk text + the user's answer for each question. Long context is essential. 
# Shares the 1,500 RPD budget with the test generator.
evaluator_llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=GOOGLE_AI_STUDIO_KEY,
    convert_system_message_to_human=True,
).with_fallbacks([sambanova_llm])

# 6. Pace optimizer — Cerebras
# Reason: The optimizer only needs to produce a short JSON output: {focus_duration_minutes, reason}. 
# This is the lightest call in the system — use the smallest, fastest model.
optimizer_llm = ChatOpenAI(
    model="llama3.1-8b",
    openai_api_base="https://api.cerebras.ai/v1",
    openai_api_key=CEREBRAS_API_KEY,
).with_fallbacks([sambanova_llm])
