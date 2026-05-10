from langgraph.graph import StateGraph, END

from backend.agents.state import AgentState
from backend.agents.planner_agent import planner_node
from backend.agents.test_generator_agent import test_generator_node
from backend.agents.evaluator_agent import evaluator_node

# ---------------------------------------------------------
# Node Stubs
# ---------------------------------------------------------

async def orchestrator_node(state: AgentState) -> dict:
    """Orchestrator: reviews state and allows routing to proceed."""
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
