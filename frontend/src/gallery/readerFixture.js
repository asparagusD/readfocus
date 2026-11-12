// Dev-only fixture for /__reader: blocks in the shape chunks.blocks stores (C12.1), three chunks.
// Text: Henry David Thoreau, Walden (1854), public domain; opening passages of two chapters.
const ECONOMY = [
  'When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labor of my hands only. I lived there two years and two months. At present I am a sojourner in civilized life again.',
  'I should not obtrude my affairs so much on the notice of my readers if very particular inquiries had not been made by my townsmen concerning my mode of life, which some would call impertinent, though they do not appear to me at all impertinent, but, considering the circumstances, very natural and pertinent. Some have asked what I got to eat; if I did not feel lonesome; if I was not afraid; and the like. Others have been curious to learn what portion of my income I devoted to charitable purposes; and some, who have large families, how many poor children I maintained.',
  'In most books, the I, or first person, is omitted; in this it will be retained; that, in respect to egotism, is the main difference. We commonly do not remember that it is, after all, always the first person that is speaking. I should not talk so much about myself if there were anybody else whom I knew as well. Unfortunately, I am confined to this theme by the narrowness of my experience.',
  'Moreover, I, on my side, require of every writer, first or last, a simple and sincere account of his own life, and not merely what he has heard of other men’s lives; some such account as he would send to his kindred from a distant land; for if he has lived sincerely, it must have been in a distant land to me.',
  'The mass of men lead lives of quiet desperation. What is called resignation is confirmed desperation. From the desperate city you go into the desperate country, and have to console yourself with the bravery of minks and muskrats. A stereotyped but unconscious despair is concealed even under what are called the games and amusements of mankind. There is no play in them, for this comes after work. But it is a characteristic of wisdom not to do desperate things.',
  'When we consider what, to use the words of the catechism, is the chief end of man, and what are the true necessaries and means of life, it appears as if men had deliberately chosen the common mode of living because they preferred it to any other. Yet they honestly think there is no choice left. But alert and healthy natures remember that the sun rose clear. It is never too late to give up our prejudices.',
];

const NECESSARIES = [
  'Food', 'Shelter', 'Clothing', 'Fuel',
];

const WHERE = [
  'At a certain season of our life we are accustomed to consider every spot as the possible site of a house. I have thus surveyed the country on every side within a dozen miles of where I live. In imagination I have bought all the farms in succession, for all were to be bought, and I knew their price.',
  'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life.',
  'Still we live meanly, like ants; though the fable tells us that we were long ago changed into men; like pygmies we fight with cranes; it is error upon error, and clout upon clout, and our best virtue has for its occasion a superfluous and evitable wretchedness. Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers, or in extreme cases he may add his ten toes, and lump the rest.',
  'Let us spend one day as deliberately as Nature, and not be thrown off the track by every nutshell and mosquito’s wing that falls on the rails. Let us rise early and fast, or break fast, gently and without perturbation; let company come and let company go, let the bells ring and the children cry, determined to make a day of it.',
  'Time is but the stream I go a-fishing in. I drink at it; but while I drink I see the sandy bottom and detect how shallow it is. Its thin current slides away, but eternity remains. I would drink deeper; fish in the sky, whose bottom is pebbly with stars.',
];

const para = (chunk, n, text, extra = {}) => ({ id: `${chunk}.${n}`, type: 'paragraph', text, marks: [], ...extra });

export const WALDEN_BLOCKS = [
  { id: '0.0', type: 'chapter', text: 'Chapter I', marks: [] },
  { id: '0.1', type: 'heading', text: 'Economy', marks: [] },
  ...ECONOMY.slice(0, 4).map((text, i) => para(0, i + 2, text,
    i === 0 ? { marks: [{ start: 170, end: 181, kind: 'em' }] } : {})),
  para(1, 0, ECONOMY[4], { marks: [{ start: 0, end: 48, kind: 'em' }] }),
  { id: '1.1', type: 'quote', text: 'It is never too late to give up our prejudices. No way of thinking or doing, however ancient, can be trusted without proof.', marks: [] },
  para(1, 2, 'By the words, necessary of life, I mean whatever, of all that man obtains by his own exertions, has been from the first, or from long use has become, so important to human life that few, if any, whether from savageness, or poverty, or philosophy, ever attempt to do without it. The necessaries of life for man in this climate may be distributed under the several heads of', { marks: [{ start: 14, end: 31, kind: 'strong' }] }),
  ...NECESSARIES.map((text, i) => ({ id: `1.${i + 3}`, type: 'list_item', text, marks: [] })),
  para(1, 7, ECONOMY[5]),
  { id: '2.0', type: 'chapter', text: 'Chapter II', marks: [] },
  { id: '2.1', type: 'heading', text: 'Where I Lived, and What I Lived For', marks: [] },
  ...WHERE.map((text, i) => para(2, i + 2, text)),
];
