"""AgentState: the typed LangGraph state every agent node reads and returns a part of.

A node returns only the keys it changes. `decisions` and `errors` are
append-only (operator.add): a node returns its own new entries, never the
list it was given, and LangGraph appends them.

Two generations of keys live side by side until the routers invoke the
whole graph (C8.6): the pipeline keys (`event`, `plan`, `answers`,
`grades`, `mastery_updates`, `policy_adjustments`, `errors`) and the keys
the current nodes and routers use (`status`, `session_plan`,
`user_answers`, `evaluation_result`, `pace_recommendation`, `error`).
"""

import operator
from typing import Annotated, Any, Literal, TypedDict

Event = Literal["start", "submit"]


class Decision(TypedDict, total=False):
    """One audit entry: which agent ran, what it was given, what it decided, by which rule."""
    agent: str
    input: Any
    output: Any
    rule: str


class AgentState(TypedDict, total=False):
    # Who and what
    user_id: str
    book_id: str
    session_id: str
    event: Event  # which flow: start a session, or submit its test
    chunk_indices: list[int]
    chunk_texts: list[str]
    test_questions: list[dict]
    time_taken_seconds: int

    # Pipeline outputs, one per agent
    plan: dict  # planner: planner.strategy.SessionPlan
    answers: list[str]  # the submitted answers, one per question
    grades: list[dict]  # evaluator: one graded answer per question
    mastery_updates: list[dict]  # knowledge state: the rows it moved
    policy_adjustments: dict  # optimizer: optimizer.pace.PaceRecommendation

    # Audit trail and failures, append-only
    decisions: Annotated[list[Decision], operator.add]
    errors: Annotated[list[str], operator.add]

    # Kept for the current nodes and routers
    status: str  # 'reading', 'testing', 'evaluating', 'completed': routes the graph until C8.5
    session_plan: dict
    user_answers: list[str]
    evaluation_result: dict
    pace_recommendation: dict
    enriched_context: dict
    error: str
