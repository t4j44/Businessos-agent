from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from supabase import create_client
import os, httpx

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

llm = ChatOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    model="anthropic/claude-sonnet-5",
)

class AgentState(TypedDict):
    client_id: str
    trigger: str
    payload: dict
    brand_context: str
    rag_context: str
    agent_output: str
    actions_taken: list
    cost_usd: float

async def load_brand_context(state: AgentState) -> AgentState:
    result = supabase.table("brand_profiles").select("*").eq("client_id", state["client_id"]).single().execute()
    if result.data:
        b = result.data
        state["brand_context"] = f"Company: {b.get('company_name')}\nICP: {b.get('icp_summary')}\nTone: {b.get('tone_description')}\nValue prop: {b.get('value_proposition')}"
    return state

async def load_rag_context(state: AgentState) -> AgentState:
    query = state["payload"].get("query", state["trigger"])
    result = supabase.table("rag_chunks").select("content").eq("client_id", state["client_id"]).eq("is_active", True).limit(5).execute()
    if result.data:
        state["rag_context"] = "\n\n".join([r["content"] for r in result.data])
    return state

async def run_agent_node(state: AgentState) -> AgentState:
    trigger = state["trigger"]
    prompt = f"""You are an AI agent for a business. Use the brand context to complete the task.

Brand context: {state['brand_context']}
Additional knowledge: {state['rag_context']}
Task: {trigger}
Data: {state['payload']}

Complete the task professionally in the brand voice. Return a clear, actionable result."""

    response = await llm.ainvoke(prompt)
    state["agent_output"] = response.content
    state["cost_usd"] = 0.01
    return state

async def save_and_act(state: AgentState) -> AgentState:
    supabase.table("agent_runs").insert({
        "client_id": state["client_id"],
        "agent_type": f"python_{state['trigger']}",
        "status": "completed",
        "output_summary": state["agent_output"][:200],
        "cost_usd": state["cost_usd"]
    }).execute()
    state["actions_taken"] = ["saved_to_agent_runs"]
    return state

def build_graph():
    workflow = StateGraph(AgentState)
    workflow.add_node("load_brand", load_brand_context)
    workflow.add_node("load_rag", load_rag_context)
    workflow.add_node("run_agent", run_agent_node)
    workflow.add_node("save_act", save_and_act)
    workflow.set_entry_point("load_brand")
    workflow.add_edge("load_brand", "load_rag")
    workflow.add_edge("load_rag", "run_agent")
    workflow.add_edge("run_agent", "save_act")
    workflow.add_edge("save_act", END)
    return workflow.compile()

graph = build_graph()

async def run_orchestrator(client_id: str, trigger: str, payload: dict) -> dict:
    result = await graph.ainvoke({
        "client_id": client_id,
        "trigger": trigger,
        "payload": payload,
        "brand_context": "",
        "rag_context": "",
        "agent_output": "",
        "actions_taken": [],
        "cost_usd": 0.0
    })
    return {"output": result["agent_output"], "actions": result["actions_taken"]}
