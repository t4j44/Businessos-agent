from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import os
from dotenv import load_dotenv
from agents.orchestrator import run_orchestrator

load_dotenv()
app = FastAPI(title="Business OS Python Agents")

class AgentRequest(BaseModel):
    client_id: str
    trigger: str  # 'brand_scout' | 'analyze_call' | 'respond_review' | 'generate_brief' | 'orchestrate'
    payload: dict = {}

class ScrapeRequest(BaseModel):
    url: str
    client_id: Optional[str] = None

@app.post("/run")
async def run_agent(req: AgentRequest, background_tasks: BackgroundTasks):
    try:
        result = await run_orchestrator(req.client_id, req.trigger, req.payload)
        return {"success": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/scrape")
async def scrape_url(req: ScrapeRequest):
    try:
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode
        async with AsyncWebCrawler() as crawler:
            config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
            result = await crawler.arun(url=req.url, config=config)
            return {
                "success": result.success,
                "markdown": result.markdown.fit_markdown[:8000] if result.markdown else "",
                "url": req.url
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "ok", "service": "business-os-python-agents"}
