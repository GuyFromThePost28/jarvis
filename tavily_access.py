"""
Vader Web Search — Tavily API integration for live, factual answers.
"""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("vader.tavily")

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")


async def search_web(query: str) -> dict:
    """Search the web via Tavily and return a clean answer."""
    if not TAVILY_API_KEY:
        return {"success": False, "answer": "Web search is not configured, sir."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "include_answer": True,
                    "max_results": 3,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                answer = (data.get("answer") or "").strip()
                sources = [r.get("url", "") for r in data.get("results", [])[:2] if r.get("url")]
                return {"success": True, "answer": answer or "No clear answer found.", "sources": sources}
            log.error(f"Tavily HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log.error(f"Tavily search error: {e}")
    return {"success": False, "answer": "Search failed — I could not reach the web, sir."}


async def format_search_result(query: str) -> str:
    """Return a spoken-friendly answer for the given query."""
    result = await search_web(query)
    return result["answer"]
