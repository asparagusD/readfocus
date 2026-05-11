import os
import asyncio
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()

GOOGLE_AI_STUDIO_KEY = os.getenv("GOOGLE_AI_STUDIO_KEY")

if not GOOGLE_AI_STUDIO_KEY:
    raise ValueError("GOOGLE_AI_STUDIO_KEY is not set in the environment variables.")

embeddings_client = GoogleGenerativeAIEmbeddings(
    google_api_key=GOOGLE_AI_STUDIO_KEY,
    model="models/text-embedding-004"
)

async def generate_embedding(text: str) -> list[float]:
    """
    Generates an embedding for the given text using Google AI Studio.
    Google's embedding API is free with no hard daily limit stated in docs — it shares the project quota. 
    If rate limited, we retry once with a 0.5s delay.
    """
    try:
        # Using aembed_query to execute asynchronously
        return await embeddings_client.aembed_query(text)
    except Exception as e:
        # If rate limited or other error, retry once
        print(f"Embedding error: {e}. Retrying after 0.5s...")
        await asyncio.sleep(0.5)
        return await embeddings_client.aembed_query(text)
