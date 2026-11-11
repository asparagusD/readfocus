// Shared by the test and results specs: a two-question session (multiple choice, written) and
// GET /sessions/t1, evaluate-single and submit-answers answered from it.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
export const QUESTIONS = [
  { question: 'In “Economy”, how does Thoreau measure the cost of a thing?\n(a) In money paid  (b) In life exchanged for it', type: 'factual',
    options: ['In money paid', 'In life exchanged for it'] },
  { question: 'In your own words, why did Thoreau go to the woods?', type: 'summary' },
];

/** Answer GET /sessions/{id}, evaluate-single and submit-answers; returns what was sent. */
export async function mockTest(page, { questions = QUESTIONS, submit = { total_score: 10, max_score: 20, percentage: 50, per_question: [] }, failSubmit = 0 } = {}) {
  const sent = { evaluations: [], submits: [] };
  await page.route(/localhost:8000\/sessions\/t1(\/.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (path === '/sessions/t1') return json({ id: 't1', book_id: 'e2e-book', test_questions: questions });
    if (path === '/sessions/t1/evaluate-single') { sent.evaluations.push(JSON.parse(req.postData())); return json({ ok: true }); }
    if (path === '/sessions/t1/submit-answers') {
      sent.submits.push(JSON.parse(req.postData()));
      if (sent.submits.length <= failSubmit) return json({ detail: 'Grading is busy' }, 503);
      return json(submit);
    }
    return route.fallback();
  });
  return sent;
}
