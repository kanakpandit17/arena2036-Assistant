import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_groq import ChatGroq
from langchain_community.vectorstores import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.prompts import PromptTemplate
from langchain.chains import RetrievalQA
from dotenv import load_dotenv
import logging
import json
import random
import time
from collections import deque
from typing import List
from trie_utils import TrieNode, OptimizedTrie

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("GROQ_API_KEY not found in .env file")

# Initialize FastAPI app
app = FastAPI(title="Arena2036 Virtual Assistant")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize embeddings and vector store
try:
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    vectorstore = Chroma(
        persist_directory="vector_db",
        collection_name="arena2036_en",
        embedding_function=embeddings
    )
    logger.info("Vector store loaded successfully")
except Exception as e:
    logger.error(f"Failed to load vector store: {str(e)}")
    raise HTTPException(status_code=500, detail="Vector store initialization failed")

# Initialize LLM with optimized settings
temperature = float(os.getenv("LLM_TEMPERATURE", 0.0))  # Deterministic by default
max_tokens = int(os.getenv("LLM_MAX_TOKENS", 1000))
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    api_key=groq_api_key,
    temperature=temperature,
    max_tokens=max_tokens,
    top_p=0.9,
    timeout=60,
    max_retries=5
)
logger.info("LLM initialized successfully")

# Main QA prompt template
prompt_template = PromptTemplate(
    input_variables=["context", "question"],
    template="""You are Arena2036's helpful virtual assistant. Provide clear, focused answers using the context provided.

RESPONSE GUIDELINES:
1. Answer directly and specifically - focus on what the user asked
2. Use simple, clear language and proper Markdown formatting
3. Structure information logically with headers (##) and bullet points when needed
4. Provide essential information without overwhelming details
5. Include only the most relevant steps or actions
6. Keep responses concise but complete
7. Use **bold** for important terms and *italics* for emphasis

Context Information:
{context}

User Question: {question}

Helpful Answer:"""
)

# Suggestions prompt template
suggestions_prompt = PromptTemplate(
    input_variables=["context"],
    template="""Based on the Arena2036 documentation context, generate 5 diverse and commonly asked questions that users might want to ask about Arena2036. 

Make the questions practical, specific, and cover different aspects like:
- Setup and configuration
- Features and functionality
- Troubleshooting
- Integration
- Account management

Context: {context}

Provide exactly 5 questions in this JSON format:
{{"suggestions": ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"]}}"""
)

# Related questions prompt template  
related_questions_prompt = PromptTemplate(
    input_variables=["context", "question"],
    template="""Based on the user's question and the Arena2036 documentation context, generate 4 related questions that users might also want to ask.

The related questions should be:
1. Relevant to the original question topic
2. Practical and actionable
3. Cover adjacent or deeper topics
4. Different from the original question

User's Question: {question}
Context: {context}

Provide exactly 4 related questions in this JSON format:
{{"related_questions": ["Related Question 1", "Related Question 2", "Related Question 3", "Related Question 4"]}}"""
)

# Configure retriever parameters tuned to your vector DB
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={
        "k": 4,         # return top 4 chunks
        "fetch_k": 8,   # consider top 8 for MMR
        "lambda_mult": 0.6
    }
)

# Initialize QA chain
qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",
    retriever=retriever,
    return_source_documents=True,
    chain_type_kwargs={"prompt": prompt_template}
)
logger.info("QA chain created with optimized retrieval settings")

# Enhanced suggestions database with scoring
ENHANCED_SUGGESTIONS_DB = [
    ("How do I connect my domain to Arena2036?", 0.9),
    ("How do I set up Arena2036 Services?", 0.95),
    ("How do I use Arena2036 Projects?", 0.9),
    ("How do I reset my Arena2036 account password?", 0.8),
    ("How do I customize my Arena2036 profile?", 0.7),
    ("How to configure Arena2036 settings?", 0.8),
    ("How to integrate Arena2036 with third-party tools?", 0.85),
    ("How to manage Arena2036 notifications?", 0.7),
    ("How to export data from Arena2036?", 0.75),
    ("How to collaborate in Arena2036 Projects?", 0.8),
    ("How to backup Arena2036 data?", 0.7),
    ("How to upgrade Arena2036 subscription?", 0.6),
    ("How to delete Arena2036 account?", 0.5),
    ("How to contact Arena2036 support?", 0.8),
    ("What are Arena2036 system requirements?", 0.6),
    ("How to troubleshoot Arena2036 login issues?", 0.85),
    ("How to share Arena2036 projects?", 0.8),
    ("How to use Arena2036 API?", 0.7),
    ("How to install Arena2036 desktop app?", 0.75),
    ("How to recover deleted Arena2036 files?", 0.8),
    ("Arena2036 pricing plans comparison", 0.6),
    ("Arena2036 security features overview", 0.7),
    ("How to migrate from other platforms to Arena2036?", 0.65),
    ("Arena2036 mobile app download", 0.7),
    ("How to create Arena2036 workspace?", 0.8),
    ("Arena2036 keyboard shortcuts list", 0.6),
    ("How to enable two-factor authentication Arena2036?", 0.75),
    ("Arena2036 data synchronization issues", 0.7),
    ("How to invite team members to Arena2036?", 0.8),
    ("Arena2036 file sharing permissions", 0.7)
]

# Initialize optimized trie
suggestion_trie = OptimizedTrie()
for suggestion, score in ENHANCED_SUGGESTIONS_DB:
    suggestion_trie.insert(suggestion, score)

def get_autocomplete_suggestions(query: str, max_results: int = 20) -> List[str]:
    """Ultra-fast autocomplete using optimized Trie."""
    if not query:
        return [item[0] for item in ENHANCED_SUGGESTIONS_DB[:max_results]]
    
    if len(query) < 2:
        # Return suggestions that start with the character
        filtered = [item[0] for item in ENHANCED_SUGGESTIONS_DB 
                   if item[0].lower().startswith(query.lower())]
        return filtered[:max_results]
    
    return suggestion_trie.search_prefix(query, max_results)

# API Endpoints
@app.get("/")
async def health_check():
    return {"status": "healthy"}

@app.get("/query")
async def query_assistant(question: str):
    try:
        logger.info(f"Query: {question}")
        res = qa_chain({"query": question})
        answer = res["result"]
        docs = res.get("source_documents", [])[:3]

        sources = []
        for doc in docs:
            url = doc.metadata.get("url", "")
            title = doc.metadata.get("title", "Resource")
            if url:
                sources.append({"url": url, "title": title})

        return {"answer": answer, "sources": sources}
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/suggestions")
async def get_suggestions(q: str = "", limit: int = 20):
    """Get autocomplete suggestions with optional query and limit."""
    try:
        start_time = time.time()
        suggestions = get_autocomplete_suggestions(q, limit)
        processing_time = (time.time() - start_time) * 1000  # Convert to ms
        
        return {
            "suggestions": suggestions,
            "query": q,
            "count": len(suggestions),
            "processing_time_ms": round(processing_time, 2)
        }
    except Exception as e:
        logger.error(f"Error getting suggestions: {str(e)}")
        fallback_suggestions = [item[0] for item in ENHANCED_SUGGESTIONS_DB[:limit]]
        return {
            "suggestions": fallback_suggestions,
            "query": q,
            "count": len(fallback_suggestions),
            "processing_time_ms": 0,
            "error": "Using fallback suggestions"
        }

@app.get("/related-questions")
async def get_related_questions(question: str):
    try:
        docs = vectorstore.similarity_search(question, k=3)
        context = "\n\n".join([doc.page_content[:400] for doc in docs])
        response = llm.generate(related_questions_prompt.format(context=context, question=question))
        data = json.loads(response[0].text)
        return data
    except Exception:
        fallback = [
            "How do I manage Arena2036 notifications?",
            "What are the Arena2036 collaboration features?", 
            "How do I integrate third-party tools with Arena2036?",
            "How do I export data from Arena2036?"
        ]
        return {"related_questions": random.sample(fallback, 4)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)