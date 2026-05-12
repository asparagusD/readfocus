import os
import asyncio
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()

GOOGLE_AI_STUDIO_KEY = os.getenv("GOOGLE_AI_STUDIO_KEY")

if not GOOGLE_AI_STUDIO_KEY:
    raise ValueError("GOOGLE_AI_STUDIO_KEY is not set in the environment variables.")

embeddings_client = GoogleGenerativeAIEmbeddings(
    google_api_key=GOOGLE_AI_STUDIO_KEY,
    model="models/gemini-embedding-2",
    output_dimensionality=1536
)

from tenacity import retry, wait_exponential, stop_after_attempt
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Wait 2^x * 1 seconds between each retry, up to 60 seconds, max 10 attempts
@retry(
    wait=wait_exponential(multiplier=1, min=2, max=60), 
    stop=stop_after_attempt(10),
    before_sleep=lambda retry_state: logger.warning(f"Rate limited or error. Retrying embedding in {retry_state.next_action.sleep}s...")
)
async def generate_embedding(text: str) -> list[float]:
    """
    Generates an embedding for the given text using Google AI Studio.
    Uses exponential backoff to handle 429 RESOURCE_EXHAUSTED errors gracefully.
    """
    return await embeddings_client.aembed_query(text)
