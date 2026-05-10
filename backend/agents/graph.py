from langgraph.graph import StateGraph, END

from backend.agents.state import AgentState
from backend.agents.planner_agent import planner_node
from backend.agents.test_generator_agent import test_generator_node
from backend.agents.evaluator_agent import evaluator_node
from backend.agents.optimizer_agent import optimizer_node

import sys
import os
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.prebuilt import create_react_agent
from backend.services.llm import orchestrator_llm

# ---------------------------------------------------------
# Node Stubs & Logic
# ---------------------------------------------------------

async def orchestrator_node(state: AgentState) -> dict:
    """Orchestrator: reviews state, fetches context via MCP, and allows routing to proceed."""
    
    server_params = StdioServerParameters(
        command=sys.executable,
        args=["backend/mcp_server.py"],
        env=os.environ.copy()
    )
    
    async with AsyncExitStack() as stack:
        read, write = await stack.enter_async_context(stdio_client(server_params))
        session = await stack.enter_async_context(ClientSession(read, write))
        
        await session.initialize()
        mcp_tools = await load_mcp_tools(session)
        
        # Inject MCP tools into orchestrator node via create_react_agent
        agent = create_react_agent(orchestrator_llm, tools=mcp_tools)
        
        user_id = state.get("user_id", "")
        book_id = state.get("book_id", "")
        chunk_indices = state.get("chunk_indices", [])
        
        prompt = f"""You are the ReadFocus Orchestrator. Before we route this session, please gather context.
        User ID: {user_id}
        Book ID: {book_id}
        Target Chunk Indices: {chunk_indices}
        
        Please use your tools to:
        1. Get the reading history and comprehension trend.
        2. If there are chunk indices, use get_chunk_context to fetch them.
        
        Output a concise summary of the context you found so downstream agents can use it."""
        
        inputs = {"messages": [("user", prompt)]}
        result = await agent.ainvoke(inputs)
        
        summary = result["messages"][-1].content
        
        enriched_context = state.get("enriched_context", {})
        enriched_context["orchestrator_summary"] = summary
        
        return {"enriched_context": enriched_context}

# ---------------------------------------------------------
# Routing Logic
# ---------------------------------------------------------

def route_event(state: AgentState) -> str:
    event = state.get("event_type")
    if event == "plan_session":
        return "planner"
    elif event == "generate_test":
        return "test_generator"
    elif event == "evaluate_answers":
        return "evaluator"
    elif event == "optimize_pace":
        return "optimizer"
    
    return END

# ---------------------------------------------------------
# Graph Construction
# ---------------------------------------------------------

graph_builder = StateGraph(AgentState)

# Add Nodes
graph_builder.add_node("orchestrator", orchestrator_node)
graph_builder.add_node("planner", planner_node)
graph_builder.add_node("test_generator", test_generator_node)
graph_builder.add_node("evaluator", evaluator_node)
graph_builder.add_node("optimizer", optimizer_node)

# Entry Point
graph_builder.set_entry_point("orchestrator")

# Conditional Edges from Orchestrator
graph_builder.add_conditional_edges(
    "orchestrator",
    route_event,
    {
        "planner": "planner",
        "test_generator": "test_generator",
        "evaluator": "evaluator",
        "optimizer": "optimizer",
        END: END
    }
)

# Edges back to END (for now, until further chaining is needed)
graph_builder.add_edge("planner", END)
graph_builder.add_edge("test_generator", END)
graph_builder.add_edge("evaluator", END)
graph_builder.add_edge("optimizer", END)

# Compile and export as 'workflow'
workflow = graph_builder.compile()
