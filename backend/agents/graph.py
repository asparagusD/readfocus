from langgraph.graph import END, StateGraph

from backend.agents.evaluator_agent import evaluator_node
from backend.agents.knowledge_state.agent import knowledge_state_node
from backend.agents.optimizer_agent import optimizer_node
from backend.agents.planner_agent import planner_node
from backend.agents.state import AgentState
from backend.agents.test_generator_agent import test_generator_node

# ---------------------------------------------------------
# Routing Logic
# ---------------------------------------------------------

def route_event(state: AgentState) -> str:
    status = state.get("status")
    
    if status == "reading":
        return "planner"
    elif status == "testing":
        return "test_generator"
    elif status == "evaluating":
        return "evaluator"
    elif status == "updating_mastery":
        return "knowledge_state"
    elif status == "completed":
        return "optimizer"
    
    return END

# ---------------------------------------------------------
# Graph Construction
# ---------------------------------------------------------

graph_builder = StateGraph(AgentState)  # type: ignore # pyre-ignore[bad-specialization]

# Add Nodes
graph_builder.add_node("planner", planner_node)
graph_builder.add_node("test_generator", test_generator_node)
graph_builder.add_node("evaluator", evaluator_node)
graph_builder.add_node("optimizer", optimizer_node)
graph_builder.add_node("knowledge_state", knowledge_state_node)

# Entry Point (use __start__)
graph_builder.add_conditional_edges(
    "__start__",
    route_event,
    {
        "planner": "planner",
        "test_generator": "test_generator",
        "evaluator": "evaluator",
        "knowledge_state": "knowledge_state",
        "optimizer": "optimizer",
        END: END
    }
)

# Edges back to END (for now, until further chaining is needed)
graph_builder.add_edge("planner", END)
graph_builder.add_edge("test_generator", END)
graph_builder.add_edge("evaluator", END)
graph_builder.add_edge("optimizer", END)
graph_builder.add_edge("knowledge_state", END)

# Compile and export as 'workflow'
workflow = graph_builder.compile()
