import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMarkers, markerLabel, pdfNoteTop, shownAnchor } from './markers.js';

const SIZE = 26;

test('notes on the same line share one marker; another line gets its own', () => {
  const spots = [
    { id: 'a', side: 'right', x: 600, top: 100 },
    { id: 'b', side: 'right', x: 600, top: 108 },
    { id: 'c', side: 'right', x: 600, top: 300 },
  ];
  assert.deepEqual(layoutMarkers(spots, { tolerance: 16, size: SIZE }), [
    { ids: ['a', 'b'], side: 'right', x: 600, top: 100 },
    { ids: ['c'], side: 'right', x: 600, top: 300 },
  ]);
});

test('markers on either page of a spread are kept apart, and close ones are pushed down, never stacked', () => {
  const spots = [
    { id: 'l', side: 'left', x: 40, top: 100 },
    { id: 'r', side: 'right', x: 600, top: 100 },
    { id: 's', side: 'right', x: 600, top: 120 }, // past the tolerance but inside the first marker
  ];
  const out = layoutMarkers(spots, { tolerance: 16, size: SIZE, gap: 4 });
  assert.deepEqual(out.map((m) => [m.ids.join(), m.side, m.top]), [['l', 'left', 100], ['r', 'right', 100], ['s', 'right', 130]]);
});

test('a marker that would sit on an obstacle (the ribbon) moves below it; one beside it stays', () => {
  const spot = [{ id: 'v', side: 'right', x: 600, top: 10 }];
  const opts = { tolerance: 16, size: SIZE, gap: 4 };
  assert.equal(layoutMarkers(spot, { ...opts, obstacles: [{ side: 'right', top: 0, bottom: 90 }] })[0].top, 94);
  assert.equal(layoutMarkers(spot, { ...opts, obstacles: [{ side: 'right', top: 0, bottom: 90, left: 610, right: 628 }] })[0].top, 94);
  assert.equal(layoutMarkers(spot, { ...opts, obstacles: [{ side: 'right', top: 0, bottom: 90, left: 627, right: 645 }] })[0].top, 10);
});

test('the marker says how many notes it opens', () => {
  assert.equal(markerLabel(1), '1 note on this passage');
  assert.equal(markerLabel(3), '3 notes on this passage');
});

test('a PDF note sits at its first quad on a page shown; a view note at the page top', () => {
  const selection = { scope: 'selection', anchors: [{ kind: 'pdf', page: 4, quads: [[72, 92, 300, 104]] }, { kind: 'pdf', page: 5, quads: [[72, 50, 90, 60]] }] };
  const view = { scope: 'view', anchors: [{ kind: 'pdf', page: 5, quads: [[0, 0, 612, 792]] }] };
  assert.deepEqual(shownAnchor(selection, [5, 6]), selection.anchors[1]);
  assert.equal(shownAnchor(selection, [7]), null);
  assert.equal(shownAnchor({ anchors: [{ kind: 'epub', cfi: 'epubcfi(/6/4!/4,/2:0,/2:5)' }] }, [1]), null);
  assert.equal(pdfNoteTop(selection.anchors[0], 50, 2), 50 + 92 * 2);
  assert.equal(pdfNoteTop(view.anchors[0], 50, 2), 50);
});
