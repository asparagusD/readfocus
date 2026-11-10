"""The agent workflow: event-driven flows from __start__, routed on state["event"].

    start_session   planner -> END
    finish_reading  test_generator -> END
    submit_answers  evaluator -> knowledge_state -> optimizer -> planner -> END
                    (the next plan is ready when the results show)
    abandon         optimizer -> END

An evaluator error ends a submit run. When every grade of the test is
low-confidence the optimizer is skipped: no adapting on unreliable evidence.
Run it through backend/agents/workflow.py, which sets the recursion limit.
"""

from langgraph.graph import END, StateGraph

from backend.agents.evaluator_agent import evaluator_node
from backend.agents.knowledge_state.agent import knowledge_state_node
from backend.agents.optimizer_agent import optimizer_node
from backend.agents.planner_agent import planner_node
from backend.agents.state import AgentState
from backend.agents.test_generator_agent import test_generator_node

ENTRY = {
    "start_session": "planner",
    "finish_reading": "test_generator",
    "submit_answers": "evaluator",
    "abandon": "optimizer",
}


def route_event(state: AgentState) -> str:
    return ENTRY.get(state.get("event") or "", END)


def after_evaluator(state: AgentState) -> str:
    return END if state.get("error") else "knowledge_state"


def after_knowledge_state(state: AgentState) -> str:
    grades = state.get("grades") or []
    return "planner" if grades and all(grade.get("confidence") == "low" for grade in grades) else "optimizer"


def after_optimizer(state: AgentState) -> str:
    return "planner" if state.get("event") == "submit_answers" else END


graph_builder = StateGraph(AgentState)  # type: ignore # pyre-ignore[bad-specialization]

graph_builder.add_node("planner", planner_node)
graph_builder.add_node("test_generator", test_generator_node)
graph_builder.add_node("evaluator", evaluator_node)
graph_builder.add_node("knowledge_state", knowledge_state_node)
graph_builder.add_node("optimizer", optimizer_node)

graph_builder.add_conditional_edges(
    "__start__", route_event,
    {"planner": "planner", "test_generator": "test_generator", "evaluator": "evaluator", "optimizer": "optimizer",
     END: END},
)
graph_builder.add_edge("planner", END)
graph_builder.add_edge("test_generator", END)
graph_builder.add_conditional_edges("evaluator", after_evaluator, {"knowledge_state": "knowledge_state", END: END})
graph_builder.add_conditional_edges(
    "knowledge_state", after_knowledge_state, {"optimizer": "optimizer", "planner": "planner"}
)
graph_builder.add_conditional_edges("optimizer", after_optimizer, {"planner": "planner", END: END})

workflow = graph_builder.compile()
