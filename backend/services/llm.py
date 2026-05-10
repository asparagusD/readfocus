import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

if not OPENROUTER_API_KEY:
    raise ValueError("OPENROUTER_API_KEY is not set in the environment variables.")

# Fallback model
# Note: This model logs prompts/completions to the provider - do not use for sensitive content.
# 1.05M context makes it the best fallback for long-context edge cases.
owl_llm = ChatOpenAI(
    model="openrouter/owl-alpha",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
)

# Orchestrator — Used for routing events and calling MCP tools
orchestrator_llm = ChatOpenAI(
    model="tencent/hy3-preview:free",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
)

# Planner — Used for session planning and reading progress analysis
planner_llm = ChatOpenAI(
    model="nvidia/nemotron-3-super-120b-a12b:free",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
    model_kwargs={"reasoning": {"enabled": True}},
)

# Test LLM — Used for generating comprehension questions
test_llm_primary = ChatOpenAI(
    model="nvidia/nemotron-3-super-120b-a12b:free",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
    model_kwargs={"reasoning": {"enabled": True}},
)
test_llm = test_llm_primary.with_fallbacks([owl_llm])

# Evaluator LLM — Used for scoring free-text answers
evaluator_llm_primary = ChatOpenAI(
    model="nvidia/nemotron-3-super-120b-a12b:free",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
    model_kwargs={"reasoning": {"enabled": True}},
)
evaluator_llm = evaluator_llm_primary.with_fallbacks([owl_llm])

# Optimizer LLM — Used only for producing a focus duration recommendation as structured JSON
optimizer_llm = ChatOpenAI(
    model="z-ai/glm-4.5-air:free",
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
)
