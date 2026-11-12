"""docs/repo-graph/AGENT_GRAPH.md matches the compiled workflow, so the diagram cannot go stale silently."""

from backend.agents import graph
from scripts import export_agent_graph


def test_agent_graph_doc_is_current():
    committed = export_agent_graph.OUT.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == export_agent_graph.render(), "run: python scripts/export_agent_graph.py"


def test_the_diagram_has_every_node_and_edge():
    text = export_agent_graph.render()
    drawn = graph.workflow.get_graph()
    for node in drawn.nodes:
        assert node in text
    assert text.count("-.->") + text.count("-->") == len(drawn.edges)
