"""
LLM Services module.

Consolidated to use Groq as the single provider for all agents to simplify setup.
"""

import os
from langchain_groq import ChatGroq
from dotenv import load_dotenv

load_dotenv()

# Read API keys from environment variables
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing. Get it from https://console.groq.com")

# Single Groq client used by all agents
groq_client = ChatGroq(
    model="llama-3.3-70b-versatile",
)

# 1. Orchestrator
orchestrator_llm = groq_client

# 2. Session planner
planner_llm = groq_client

# 3. Test generator
test_llm = groq_client

# 4. Answer evaluator
evaluator_llm = groq_client

# 5. Pace optimizer
optimizer_llm = groq_client
