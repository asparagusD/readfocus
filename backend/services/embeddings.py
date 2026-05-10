import os
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

if not OPENROUTER_API_KEY:
    raise ValueError("OPENROUTER_API_KEY is not set in the environment variables.")

embeddings_client = OpenAIEmbeddings(
    openai_api_base=OPENROUTER_BASE_URL,
    openai_api_key=OPENROUTER_API_KEY,
    # Using a default embedding model supported via OpenRouter
    model="nomic-ai/nomic-embed-text"
)

def generate_embedding(text: str) -> list[float]:
    """
    Generates an embedding for the given text using OpenRouter's OpenAIEmbeddings.
    """
    return embeddings_client.embed_query(text)
