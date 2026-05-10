from typing import TypedDict, List, Dict, Optional
from langgraph.graph import StateGraph, END

class AgentState(TypedDict, total=False):
    user_id: str
    book_id: str
    session_id: str
    event_type: str  # 'plan_session', 'generate_test', 'evaluate_answers', 'optimize_pace'
    chunk_indices: list[int]
    chunk_texts: list[str]
    session_plan: dict
    test_questions: list[dict]
    user_answers: list[str]
    evaluation_result: dict
    pace_recommendation: dict
    enriched_context: dict
    error: str

# ---------------------------------------------------------
# Node Stubs
# ---------------------------------------------------------

async def orchestrator_node(state: AgentState) -> dict:
    """Orchestrator: reviews state and allows routing to proceed."""
    return {}

async def planner_node(state: AgentState) -> dict:
    """Planner: determines session chunk assignments."""
    return {}

async def test_generator_node(state: AgentState) -> dict:
    """Test Generator: creates comprehension questions from chunks."""
    return {}

async def evaluator_node(state: AgentState) -> dict:
    """Evaluator: scores the free-text answers against chunks."""
    return {}

async def optimizer_node(state: AgentState) -> dict:
    """Optimizer: recommends pace adjustments based on evaluation."""
    return {}

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
