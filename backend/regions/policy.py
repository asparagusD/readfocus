"""Region-map constants (C18): every threshold the region map uses, in one place.

backend/regions/ reads these and holds no numbers of its own; change
behaviour here and cover the boundary in the module's tests. Sizes in em
are multiples of the line's median font size. Moved here from
backend/agents/policy.py in C18.3: the region map is not an agent.
"""

# --- Region map: garbled text (backend/regions/garble.py, C18.1) -------------

# Text is garbled when this share (0..1) of its visible characters is
# suspicious, or when any hard signal appears at all.
GARBLE_MAX_RATIO = 0.05
# Signals that never occur in a clean extraction: one is enough.
GARBLE_HARD_REASONS = ("replacement", "private_use", "cid", "control")
# Single letters separated by spaces ("T h e", a TeX equation read glyph by
# glyph): this many letters in one run of one-character tokens is a signal.
# Inline maths such as "a + b = c + d" has fewer letters per run.
GARBLE_SPACED_RUN = 6

# --- Region map: characters, lines and blocks (backend/regions/extract.py, C18.2)

# Sizes are in em: multiples of the line's median font size.
# A character smaller than this share of the page's median size (a sub- or
# superscript, a footnote mark) joins the line it overlaps most.
REGION_SMALL_CHAR = 0.8
# A character joins a line when they overlap vertically by at least this
# share of the smaller height (0.3 lets a raised "2" join its "x").
REGION_LINE_OVERLAP = 0.3
# A horizontal gap wider than this is a space between words. TeX shrinks
# its interword space to about 0.11 em in tight lines; letters sit closer.
REGION_WORD_GAP_EM = 0.1
# A gap wider than this splits a line in two (a column gutter).
REGION_COLUMN_GAP_EM = 2.5
# Consecutive lines that overlap horizontally form one block while the gap
# between them is at most this.
REGION_BLOCK_GAP_EM = 0.9

# --- Region map: math (backend/regions/classify.py, C18.3) -------------------

# Font families that set mathematics (subset prefix already dropped): TeX's
# Computer Modern and AMS fonts, txfonts/pxfonts and their "r" variants,
# MathDesign, Cambria Math, STIX, Latin Modern Math, and any "*Math*".
MATH_FONT_PATTERN = (r"^(CMMI|CMSY|CMEX|CMBSY|MSAM|MSBM|EUFM|EUSM|EUEX|RSFS|rtx|tx(mi|sy|ex|r$)|px(mi|sys?|ex)|"
                     r"MathDesign|Cambria.?Math|STIX|LatinModernMath|LMMath|XITS|Asana)|Math")
# Monospace families: their characters are code, never math evidence (C18.4
# reads the same pattern).
MONO_FONT_PATTERN = (r"Mono|NimbusMon|Courier|Consolas|Menlo|Monaco|Inconsolata|CMTT|LMTypewriter|SourceCode|"
                     r"Fira(Code|Mono)|Typewriter|Lucida.?Console")
# A character this far off its line's baseline (em), and no larger than this
# share of the line's size, is a sub- or superscript.
MATH_SCRIPT_OFFSET_EM = 0.12  # TeX lowers subscripts about 0.15 em
MATH_SCRIPT_SIZE = 0.9
# A clearly smaller character needs less offset (Libertine lowers subscripts about 0.08 em).
MATH_SMALL_SCRIPT_SIZE = 0.8
MATH_SMALL_SCRIPT_OFFSET_EM = 0.06
# Units after a number ("5 Ω", "90°") are not math.
MATH_UNIT_SYMBOLS = "ΩΩ°µμ℃"
# A line is display math when this share of its visible characters is math
# evidence and it holds at least DISPLAY_MIN_STRONG such characters, one an
# operator or relation; a line set off from the text column needs less.
MATH_DISPLAY_SHARE = 0.4
MATH_DISPLAY_SET_OFF_SHARE = 0.15
MATH_DISPLAY_MIN_STRONG = 2
# Set off: indented from the text column's left edge by at least this.
MATH_SET_OFF_INDENT_EM = 2.0
# The text column: median edges of lines with at least this many characters.
MATH_COLUMN_LINE_CHARS = 40
# Display lines (and their fragments) closer than this stay one region.
MATH_GROUP_GAP_EM = 1.0
# A short line next to a display joins it: a radical's top, a limit, a
# lone bracket, a fraction's numerator or denominator.
MATH_FRAGMENT_MAX_CHARS = 3
# Stacked short lines (a fraction) with math evidence are display math.
MATH_STACK_MAX_CHARS = 12
MATH_STACK_GAP_EM = 0.6
# An equation number at the right of a display: "(3.2)", "(4.2.1)", "(12a)".
MATH_EQUATION_NUMBER = r"^\((\d+(?:\.\d+)*[a-z]?)\)$"
MATH_EQUATION_NUMBER_MARGIN_EM = 3.0
# A line at least this share monospace is code: no inline math in it.
MATH_MONO_LINE_SHARE = 0.5
# Inline math: tokens next to math evidence join a span when they are this
# short (a digit, a lone letter, brackets), and a word of at least
# MATH_WORD_LETTERS plain letters glued to the front or back of a token is
# trimmed off it ("withpn" -> "pn").
MATH_INLINE_SHORT = 3
MATH_WORD_LETTERS = 3
# Evaluation on hand labels: a predicted region matches a label when their
# boxes overlap with at least this intersection over union.
MATH_MATCH_IOU = 0.6

# --- Region map: code (backend/regions/code.py, C18.4) -----------------------

# A line is code when at least this share of its visible characters is
# monospace: a MONO_FONT_PATTERN name, or a font whose name says nothing
# (CODE_UNNAMED_FONT_PATTERN) and whose narrow and wide letters share one
# advance across the page (spread at most CODE_EQUAL_ADVANCE_SPREAD of the
# mean width, over at least CODE_EQUAL_ADVANCE_MIN_CHARS characters).
CODE_MONO_SHARE = 0.8
# A line this share monospace is still code when none of its other letters
# make a word of CODE_PROSE_WORD_LETTERS (a template line "(if ⟨??⟩").
CODE_TEMPLATE_SHARE = 0.4
CODE_PROSE_WORD_LETTERS = 3
# A block needs this many letters or digits (a lone "∞" in a mono font is not code).
CODE_MIN_ALNUM = 2
CODE_UNNAMED_FONT_PATTERN = r"^([A-Z]{1,3}\d+(_\d+)?|Type3|T3Font_\d+)$"
CODE_EQUAL_ADVANCE_SPREAD = 0.03
CODE_EQUAL_ADVANCE_MIN_CHARS = 12
# Code lines further apart than this many line heights start a new block.
CODE_MAX_GAP_LINES = 3.0
# Lines whose baselines differ by less than this (em) are one row.
CODE_SAME_ROW_EM = 0.3
# A line-number gutter: a number, then at least this many character widths
# of space, opening at least CODE_GUTTER_MIN_ROWS rows and this share of the
# block's rows, counting up by one.
CODE_GUTTER_GAP_CHARS = 0.8
CODE_GUTTER_MIN_ROWS = 3
CODE_GUTTER_SHARE = 0.6
# The best language's keyword score must reach this, and beat the next.
CODE_LANGUAGE_MIN_SCORE = 3

# --- Region map: figures, tables, drawn math, columns (backend/regions/figures.py, C18.5)

# The table finder runs only on pages with at least this many long thin
# edges each way (points; a rect counts by its sides).
TABLE_RULE_MIN_LENGTH = 24.0
TABLE_RULE_MAX_THICKNESS = 2.0
TABLE_MIN_RULES = 2
# A found table needs this many rows and columns and this share of cells
# with text (a shaded one-cell box around a theorem is not a table).
TABLE_MIN_ROWS = 2
TABLE_MIN_COLUMNS = 2
TABLE_MIN_FILLED = 0.5
# Drawing objects closer than this (em of the page's body text) are one cluster.
FIGURE_CLUSTER_GAP_EM = 0.8
# A cluster is a figure when it holds an image at least this many em on its
# shorter side, or covers at least this many square em; a cluster with no
# side this long (a lone rule) is nothing.
FIGURE_MIN_IMAGE_SIDE_EM = 3.0
FIGURE_MIN_AREA_EM2 = 25.0
FIGURE_MIN_SIDE_EM = 1.5
# A vector drawing has at least this many objects (one filled rect is a bar or a
# page-edge tab, not a figure).
FIGURE_MIN_VECTOR_OBJECTS = 3
# Glyph-sized objects (no side over this many em) make up at least this
# share of a cluster drawn as text: math set as outlines, not a figure.
DRAWN_GLYPH_MAX_EM = 2.5
DRAWN_GLYPH_SHARE = 0.8
DRAWN_MIN_OBJECTS = 3
# A drawn cluster overlapping a text line by this share of its height is
# inline in that line.
DRAWN_INLINE_OVERLAP = 0.5
# Captions: "Figure 3.4", "Fig. 2", "Table 1.2", within this many em of
# the figure or table, above or below.
CAPTION_PATTERN = r"^((?:Figure|FIGURE|Fig\.|Table|TABLE)\s*\d+(?:[.\-]\d+)*[a-z]?)"
CAPTION_GAP_EM = 2.5
# A page has two columns when at least this many lines sit wholly on each
# side of a clean gutter and this share of all lines does.
COLUMN_MIN_LINES = 2
COLUMN_MIN_SHARE = 0.25
# A rect with at least this many text lines inside frames text (a shaded
# box, an "EXAMPLE" banner): not a drawing.
FRAME_MIN_LINES = 1
# A drawing whose text lines cover more than this share of it is a text box.
FIGURE_MAX_TEXT_SHARE = 0.3
# A gutter may be crossed by at most this share of lines, or COLUMN_MIN_CROSSING
# lines on a short page (full-width headings).
COLUMN_MAX_CROSSING = 0.15
COLUMN_MIN_CROSSING = 2

# --- Region map: prose-only agent text (backend/regions/prose.py, C18.6) -------

# A caption in a placeholder ("[Figure 3.4: <caption>, p. 47]") is cut to
# this many characters, at a word, with an ellipsis.
PLACEHOLDER_CAPTION_MAX = 120
# A pypdf line at least this long (non-space characters) found inside a
# non-prose region is that region's, even if a prose region also holds it.
PROSE_EXCLUSIVE_MIN = 12
# A line this short or shorter next to a line of a non-prose region whose text
# holds it (a figure label, an operator alone on its line) goes with it.
PROSE_SANDWICH_MAX = 3
# A line not found exactly may still match a non-prose region when it is at
# least PROSE_FUZZY_MIN long and rapidfuzz's partial_ratio is at least this.
PROSE_FUZZY_MIN = 4
PROSE_FUZZY_RATIO = 90
# Inline math is found in the page by its text plus this many non-space
# characters of context on each side.
PROSE_INLINE_CONTEXT = 6
