// The question bank: 7 categories x 3 academic levels. Content difficulty rises
// with the academic level (Middle -> High -> College), NOT with sheer volume.
// Each question is tagged with a `sub` (sub-topic) and `tier` (0=easier within
// the level, 2=harder) so the adaptive engine can climb a concept ladder
// instead of repeating identical items.
//
// Questions come in two shapes:
//   { q, choices:[...], a: <index>, ... }      multiple choice
//   { q, answer: "text"|number, accept:[...] }  typed answer (numbers fuzzy-matched)

let _id = 0;
const Q = (o) => ({ id: `q${_id++}`, ...o });

// Helper for numeric typed answers.
const num = (q, answer, opts = {}) => Q({ q, answer, numeric: true, ...opts });
const mc = (q, choices, a, opts = {}) => Q({ q, choices, a, ...opts });

export const BANK = {
  // =====================================================================
  math: {
    middle: [
      num('What is 7 × 8?', 56, { sub: 'arithmetic', tier: 0 }),
      num('What is 144 ÷ 12?', 12, { sub: 'arithmetic', tier: 0 }),
      mc('Which fraction is largest?', ['1/2', '2/5', '3/8', '1/3'], 0, { sub: 'fractions', tier: 1 }),
      num('Simplify 6/8 to lowest terms — enter the numerator over 4.', 3, { sub: 'fractions', tier: 1, hint: 'e.g. 3' }),
      num('A recipe uses a 2:3 ratio of sugar to flour. With 6 cups of sugar, how many cups of flour?', 9, { sub: 'ratios', tier: 1 }),
      num('What is the perimeter of a rectangle 5 by 3?', 16, { sub: 'geometry', tier: 1 }),
      num('Area of a triangle with base 10 and height 4?', 20, { sub: 'geometry', tier: 2 }),
      mc('Next in the pattern: 2, 4, 8, 16, ...', ['24', '30', '32', '20'], 2, { sub: 'patterns', tier: 1 }),
      mc('If all Bloops are Razzies and all Razzies are Lazzies, then all Bloops are…', ['Lazzies', 'not Lazzies', 'sometimes Lazzies', 'unknown'], 0, { sub: 'logic', tier: 2 }),
      num('What is 15% of 200?', 30, { sub: 'percent', tier: 2 }),
    ],
    high: [
      num('Solve for x: 3x + 7 = 22', 5, { sub: 'algebra', tier: 0 }),
      mc('Factor x² − 9', ['(x−3)(x+3)', '(x−9)(x+1)', '(x−3)²', '(x+9)(x−1)'], 0, { sub: 'algebra', tier: 1 }),
      num('The hypotenuse of a right triangle with legs 3 and 4?', 5, { sub: 'geometry', tier: 1 }),
      mc('sin(30°) equals', ['1/2', '√3/2', '1', '0'], 0, { sub: 'trig', tier: 1 }),
      mc('cos(60°) equals', ['1/2', '√2/2', '√3/2', '0'], 0, { sub: 'trig', tier: 2 }),
      mc('Probability of rolling a sum of 7 with two dice?', ['1/6', '1/8', '1/12', '5/36'], 0, { sub: 'probability', tier: 2 }),
      num('Mean of 4, 8, 10, 10, 8?', 8, { sub: 'statistics', tier: 1 }),
      mc('The slope of the line through (1,2) and (3,8)?', ['3', '2', '6', '1/3'], 0, { sub: 'algebra', tier: 1 }),
      mc('Which is a quadratic function?', ['y = x² + 1', 'y = 2x + 1', 'y = 1/x', 'y = √x'], 0, { sub: 'functions', tier: 0 }),
      num('If f(x) = 2x² and x = 3, f(x) = ?', 18, { sub: 'functions', tier: 1 }),
    ],
    college: [
      mc('d/dx of x³ is', ['3x²', 'x²', '3x', 'x⁴/4'], 0, { sub: 'calculus', tier: 0 }),
      mc('∫ 2x dx equals', ['x² + C', '2 + C', 'x²/2 + C', '2x² + C'], 0, { sub: 'calculus', tier: 1 }),
      mc('The derivative of sin(x) is', ['cos(x)', '−cos(x)', '−sin(x)', 'tan(x)'], 0, { sub: 'calculus', tier: 1 }),
      mc('A 2×2 matrix determinant [[a,b],[c,d]] is', ['ad − bc', 'ab − cd', 'ac − bd', 'ad + bc'], 0, { sub: 'linear-algebra', tier: 1 }),
      mc('The limit of (1 + 1/n)^n as n→∞ is', ['e', '1', '∞', '0'], 0, { sub: 'calculus', tier: 2 }),
      mc('Eigenvalues relate to which equation?', ['Av = λv', 'Av = 0', 'A = v', 'det(A)=1'], 0, { sub: 'linear-algebra', tier: 2 }),
      mc('How many ways to choose 2 from 5 (combinations)?', ['10', '20', '5', '25'], 0, { sub: 'combinatorics', tier: 1 }),
      mc('A proof by contradiction assumes', ['the negation of the claim', 'the claim is true', 'a base case', 'nothing'], 0, { sub: 'logic', tier: 2 }),
      mc('The general solution to y′ = y is', ['Ce^x', 'x + C', 'ln x', 'sin x'], 0, { sub: 'diff-eq', tier: 2 }),
      mc('P(A and B) for independent events is', ['P(A)·P(B)', 'P(A)+P(B)', 'P(A)/P(B)', 'P(A)−P(B)'], 0, { sub: 'stats', tier: 1 }),
    ],
  },

  // =====================================================================
  cs: {
    middle: [
      mc('A program is best described as', ['a set of instructions', 'a type of computer', 'a website', 'a monitor'], 0, { sub: 'concepts', tier: 0 }),
      mc('A variable is used to', ['store a value', 'delete files', 'print paper', 'cool the CPU'], 0, { sub: 'variables', tier: 0 }),
      mc('Which is a boolean value?', ['true', '42', '"cat"', '3.14'], 0, { sub: 'types', tier: 1 }),
      mc('Breaking a big problem into smaller steps is called', ['decomposition', 'compression', 'encryption', 'rendering'], 0, { sub: 'thinking', tier: 1 }),
      mc('Which symbol usually means "not equal" in code?', ['!=', '==', '=>', '&&'], 0, { sub: 'syntax', tier: 1 }),
      mc('An algorithm is', ['a step-by-step procedure', 'a bug', 'a keyboard', 'a pixel'], 0, { sub: 'concepts', tier: 0 }),
    ],
    high: [
      mc('What does this print? for i in range(3): print(i)', ['0 1 2', '1 2 3', '0 1 2 3', '3'], 0, { sub: 'loops', tier: 0 }),
      mc('A function that calls itself is', ['recursive', 'iterative', 'static', 'global'], 0, { sub: 'functions', tier: 1 }),
      mc('Which data structure is LIFO?', ['Stack', 'Queue', 'Array', 'Tree'], 0, { sub: 'data-structures', tier: 1 }),
      mc('Big-O of linear search worst case?', ['O(n)', 'O(1)', 'O(log n)', 'O(n²)'], 0, { sub: 'algorithms', tier: 2 }),
      mc('if (x > 5 && x < 10) is true when x =', ['7', '5', '10', '12'], 0, { sub: 'conditionals', tier: 0 }),
      mc('A bug is', ['a defect in code', 'a feature', 'a compiler', 'a variable'], 0, { sub: 'debugging', tier: 0 }),
      mc('Which sorts fastest on average?', ['Quicksort', 'Bubble sort', 'Selection sort', 'None'], 0, { sub: 'algorithms', tier: 2 }),
      mc('An array index typically starts at', ['0', '1', '−1', 'any'], 0, { sub: 'data-structures', tier: 1 }),
    ],
    college: [
      mc('Binary search requires the data to be', ['sorted', 'unsorted', 'hashed', 'linked'], 0, { sub: 'algorithms', tier: 1 }),
      mc('Big-O of binary search?', ['O(log n)', 'O(n)', 'O(n log n)', 'O(1)'], 0, { sub: 'algorithms', tier: 1 }),
      mc('A hash table gives average lookup of', ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], 0, { sub: 'data-structures', tier: 2 }),
      mc('Deadlock requires all EXCEPT', ['preemption', 'mutual exclusion', 'hold and wait', 'circular wait'], 0, { sub: 'os', tier: 2 }),
      mc('SQL command to retrieve rows?', ['SELECT', 'INSERT', 'DELETE', 'UPDATE'], 0, { sub: 'databases', tier: 0 }),
      mc('A stack overflow often comes from', ['unbounded recursion', 'too much RAM', 'a fast CPU', 'a good cache'], 0, { sub: 'systems', tier: 2 }),
      mc('Public-key crypto uses', ['two keys', 'one key', 'no keys', 'a password only'], 0, { sub: 'security', tier: 1 }),
      mc('Supervised learning needs', ['labeled data', 'no data', 'only images', 'a GPU only'], 0, { sub: 'ai', tier: 1 }),
    ],
  },

  // =====================================================================
  science: {
    middle: [
      mc('The basic unit of life is the', ['cell', 'atom', 'molecule', 'organ'], 0, { sub: 'biology', tier: 0 }),
      mc('Water is made of hydrogen and', ['oxygen', 'nitrogen', 'carbon', 'helium'], 0, { sub: 'chemistry', tier: 0 }),
      mc('Which is a form of energy?', ['heat', 'iron', 'granite', 'copper'], 0, { sub: 'physics', tier: 1 }),
      mc('Plants make food using', ['photosynthesis', 'digestion', 'respiration only', 'osmosis'], 0, { sub: 'biology', tier: 1 }),
      mc('An ecosystem includes', ['living and non-living things', 'only animals', 'only plants', 'only water'], 0, { sub: 'ecology', tier: 1 }),
      mc('Which state of matter has a fixed shape?', ['solid', 'liquid', 'gas', 'plasma'], 0, { sub: 'matter', tier: 0 }),
    ],
    high: [
      mc('Newton\'s 2nd law is', ['F = ma', 'E = mc²', 'PV = nRT', 'a² + b² = c²'], 0, { sub: 'physics', tier: 1 }),
      mc('The powerhouse of the cell is the', ['mitochondria', 'nucleus', 'ribosome', 'membrane'], 0, { sub: 'biology', tier: 0 }),
      mc('Table salt\'s chemical formula is', ['NaCl', 'H2O', 'CO2', 'O2'], 0, { sub: 'chemistry', tier: 0 }),
      mc('DNA carries the code in its', ['base sequence', 'sugar count', 'color', 'weight'], 0, { sub: 'genetics', tier: 2 }),
      mc('Acceleration due to gravity ≈', ['9.8 m/s²', '3.0 m/s²', '1.0 m/s²', '20 m/s²'], 0, { sub: 'physics', tier: 1 }),
      mc('pH below 7 is', ['acidic', 'basic', 'neutral', 'salty'], 0, { sub: 'chemistry', tier: 1 }),
      mc('A chemical change occurs when', ['new substances form', 'ice melts', 'you cut paper', 'water evaporates'], 0, { sub: 'chemistry', tier: 2 }),
    ],
    college: [
      mc('The 1st law of thermodynamics is about', ['energy conservation', 'entropy', 'gravity', 'momentum'], 0, { sub: 'physics', tier: 1 }),
      mc('Entropy of an isolated system tends to', ['increase', 'decrease', 'stay zero', 'oscillate'], 0, { sub: 'thermo', tier: 2 }),
      mc('Organic chemistry centers on which element?', ['carbon', 'silicon', 'iron', 'sodium'], 0, { sub: 'orgo', tier: 0 }),
      mc('Transcription produces', ['mRNA from DNA', 'DNA from RNA', 'protein from DNA', 'lipids'], 0, { sub: 'molecular-bio', tier: 2 }),
      mc('Maxwell\'s equations describe', ['electromagnetism', 'gravity', 'thermodynamics', 'genetics'], 0, { sub: 'em', tier: 2 }),
      mc('The Heisenberg uncertainty principle pairs', ['position and momentum', 'mass and charge', 'time and temperature', 'force and area'], 0, { sub: 'quantum', tier: 2 }),
      mc('Enzymes act as biological', ['catalysts', 'fuels', 'walls', 'wastes'], 0, { sub: 'biochem', tier: 1 }),
      mc('Natural selection acts on', ['heritable variation', 'learned skills', 'individual wishes', 'weather'], 0, { sub: 'evolution', tier: 1 }),
    ],
  },

  // =====================================================================
  geo: {
    middle: [
      mc('How many continents are there?', ['7', '5', '6', '8'], 0, { sub: 'basics', tier: 0 }),
      mc('The largest ocean is the', ['Pacific', 'Atlantic', 'Indian', 'Arctic'], 0, { sub: 'oceans', tier: 0 }),
      mc('The capital of France is', ['Paris', 'Rome', 'Madrid', 'Berlin'], 0, { sub: 'capitals', tier: 1 }),
      mc('The Nile River is mainly in', ['Africa', 'Asia', 'Europe', 'South America'], 0, { sub: 'physical', tier: 1 }),
      mc('Which direction does a compass needle point?', ['North', 'South', 'East', 'West'], 0, { sub: 'navigation', tier: 0 }),
      mc('The equator divides Earth into', ['hemispheres', 'time zones', 'continents', 'oceans'], 0, { sub: 'basics', tier: 1 }),
    ],
    high: [
      mc('The most populous country (2020s) is roughly tied between India and', ['China', 'USA', 'Brazil', 'Russia'], 0, { sub: 'population', tier: 1 }),
      mc('A rain shadow forms on the ___ side of a mountain', ['leeward', 'windward', 'northern', 'southern'], 0, { sub: 'climate', tier: 2 }),
      mc('The Amazon rainforest is mostly in', ['Brazil', 'Peru', 'Colombia', 'Bolivia'], 0, { sub: 'physical', tier: 1 }),
      mc('Lines of longitude measure distance', ['east–west', 'north–south', 'up–down', 'diagonally'], 0, { sub: 'navigation', tier: 1 }),
      mc('OPEC primarily controls', ['oil', 'wheat', 'gold', 'water'], 0, { sub: 'resources', tier: 2 }),
      mc('A country\'s GDP measures its', ['economic output', 'land area', 'population only', 'coastline'], 0, { sub: 'geopolitics', tier: 1 }),
    ],
    college: [
      mc('GIS stands for Geographic ___ Systems', ['Information', 'Imaging', 'Interval', 'Internet'], 0, { sub: 'gis', tier: 1 }),
      mc('Demographic transition links birth rates to', ['development', 'latitude', 'altitude', 'religion only'], 0, { sub: 'demographics', tier: 2 }),
      mc('The Coriolis effect deflects moving air due to Earth\'s', ['rotation', 'orbit', 'tilt', 'gravity'], 0, { sub: 'climate-systems', tier: 2 }),
      mc('Economic geography studies the ___ of activity', ['spatial distribution', 'chemical makeup', 'genetic basis', 'legal code'], 0, { sub: 'economic-geo', tier: 2 }),
      mc('A choropleth map shades regions by', ['a data value', 'elevation only', 'temperature only', 'random color'], 0, { sub: 'gis', tier: 1 }),
      mc('Geopolitics analyzes power and', ['geography', 'chemistry', 'biology', 'grammar'], 0, { sub: 'geopolitics', tier: 1 }),
    ],
  },

  // =====================================================================
  history: {
    middle: [
      mc('The pyramids of Giza were built in ancient', ['Egypt', 'Greece', 'Rome', 'China'], 0, { sub: 'ancient', tier: 0 }),
      mc('Who was the first US President?', ['Washington', 'Lincoln', 'Jefferson', 'Adams'], 0, { sub: 'figures', tier: 0 }),
      mc('The Great Wall is located in', ['China', 'India', 'Japan', 'Korea'], 0, { sub: 'ancient', tier: 1 }),
      mc('Democracy originated in ancient', ['Greece', 'Rome', 'Egypt', 'Persia'], 0, { sub: 'ancient', tier: 1 }),
      mc('Which came first?', ['Stone Age', 'Iron Age', 'Bronze Age', 'Space Age'], 0, { sub: 'timelines', tier: 1 }),
    ],
    high: [
      mc('WWII ended in the year', ['1945', '1918', '1939', '1963'], 0, { sub: 'world', tier: 0 }),
      mc('The Industrial Revolution began in', ['Britain', 'France', 'USA', 'Germany'], 0, { sub: 'world', tier: 1 }),
      mc('The US Declaration of Independence was signed in', ['1776', '1787', '1620', '1865'], 0, { sub: 'us', tier: 1 }),
      mc('The three branches of US government are legislative, executive, and', ['judicial', 'military', 'federal', 'social'], 0, { sub: 'government', tier: 1 }),
      mc('The Cold War was primarily between the US and the', ['USSR', 'UK', 'China', 'Japan'], 0, { sub: 'world', tier: 2 }),
      mc('The French Revolution began in', ['1789', '1776', '1848', '1914'], 0, { sub: 'world', tier: 2 }),
    ],
    college: [
      mc('Historiography is the study of', ['how history is written', 'ancient maps', 'fossils', 'languages'], 0, { sub: 'method', tier: 2 }),
      mc('A primary source is', ['a firsthand record', 'a textbook', 'a summary', 'an encyclopedia'], 0, { sub: 'sources', tier: 1 }),
      mc('The Treaty of Westphalia (1648) shaped the idea of', ['state sovereignty', 'free trade', 'human rights', 'space law'], 0, { sub: 'political-phil', tier: 2 }),
      mc('Marx analyzed history through', ['class conflict', 'divine right', 'geography only', 'genetics'], 0, { sub: 'political-phil', tier: 2 }),
      mc('The Columbian Exchange transferred', ['crops and disease', 'only gold', 'only slaves', 'nothing'], 0, { sub: 'comparative', tier: 2 }),
    ],
  },

  // =====================================================================
  lang: {
    middle: [
      mc('Which is a noun?', ['dog', 'quickly', 'run', 'blue'], 0, { sub: 'grammar', tier: 0 }),
      mc('The plural of "child" is', ['children', 'childs', 'childes', 'child'], 0, { sub: 'grammar', tier: 0 }),
      mc('A synonym for "happy" is', ['joyful', 'sad', 'tired', 'angry'], 0, { sub: 'vocab', tier: 1 }),
      mc('Which sentence is complete?', ['She runs.', 'Running fast.', 'The big.', 'Because he.'], 0, { sub: 'structure', tier: 1 }),
      mc('An antonym for "hot" is', ['cold', 'warm', 'spicy', 'red'], 0, { sub: 'vocab', tier: 0 }),
    ],
    high: [
      mc('"The wind whispered" is an example of', ['personification', 'a simile', 'a metaphor', 'hyperbole'], 0, { sub: 'literature', tier: 1 }),
      mc('Which is a metaphor?', ['Time is a thief', 'Fast as a cheetah', 'Very loud', 'She ran'], 0, { sub: 'literature', tier: 1 }),
      mc('A thesis statement belongs in the', ['introduction', 'middle', 'conclusion only', 'title'], 0, { sub: 'essay', tier: 1 }),
      mc('Rhetoric\'s appeal to logic is called', ['logos', 'pathos', 'ethos', 'kairos'], 0, { sub: 'rhetoric', tier: 2 }),
      mc('An appeal to emotion is', ['pathos', 'logos', 'ethos', 'syntax'], 0, { sub: 'rhetoric', tier: 2 }),
      mc('The subject of "Birds fly south" is', ['Birds', 'fly', 'south', 'the'], 0, { sub: 'grammar', tier: 0 }),
    ],
    college: [
      mc('Linguistics studies the ___ of language', ['structure', 'price', 'weight', 'color'], 0, { sub: 'linguistics', tier: 1 }),
      mc('Phonology is the study of', ['sound systems', 'word meaning', 'sentence order', 'writing'], 0, { sub: 'linguistics', tier: 2 }),
      mc('Syntax refers to', ['sentence structure', 'sound', 'meaning', 'spelling'], 0, { sub: 'linguistics', tier: 1 }),
      mc('A close reading focuses on', ['the text itself', 'the author\'s biography', 'sales', 'the cover'], 0, { sub: 'literary-analysis', tier: 2 }),
      mc('Ethos in rhetoric establishes', ['credibility', 'emotion', 'logic', 'timing'], 0, { sub: 'rhetorical-theory', tier: 2 }),
    ],
  },

  // =====================================================================
  finance: {
    middle: [
      mc('Money you earn from a job is called', ['income', 'expense', 'debt', 'tax'], 0, { sub: 'basics', tier: 0 }),
      mc('Setting aside money for later is', ['saving', 'spending', 'borrowing', 'lending'], 0, { sub: 'basics', tier: 0 }),
      mc('A budget helps you', ['plan spending', 'earn interest', 'avoid taxes', 'print money'], 0, { sub: 'budgeting', tier: 1 }),
      num('You earn $50 and spend $30. How much is left?', 20, { sub: 'basics', tier: 0 }),
      mc('Money you owe is called', ['debt', 'income', 'savings', 'profit'], 0, { sub: 'basics', tier: 1 }),
    ],
    high: [
      num('Simple interest on $100 at 5% for 1 year? (dollars)', 5, { sub: 'interest', tier: 1 }),
      mc('If demand rises and supply stays fixed, price tends to', ['rise', 'fall', 'stay flat', 'vanish'], 0, { sub: 'micro', tier: 1 }),
      mc('A credit score measures', ['creditworthiness', 'income', 'age', 'height'], 0, { sub: 'credit', tier: 1 }),
      mc('Diversifying investments reduces', ['risk', 'return only', 'taxes', 'inflation'], 0, { sub: 'investing', tier: 2 }),
      mc('Inflation means prices generally', ['rise', 'fall', 'freeze', 'reset'], 0, { sub: 'macro', tier: 1 }),
      mc('Which is a progressive tax feature?', ['higher rate on higher income', 'flat rate', 'no rate', 'random rate'], 0, { sub: 'taxes', tier: 2 }),
    ],
    college: [
      mc('GDP measures a nation\'s', ['total output', 'debt only', 'population', 'land'], 0, { sub: 'macro', tier: 1 }),
      mc('The Fed sets US ___ policy', ['monetary', 'fiscal', 'trade', 'foreign'], 0, { sub: 'monetary', tier: 2 }),
      mc('Opportunity cost is', ['the next-best forgone option', 'total cost', 'sunk cost', 'zero'], 0, { sub: 'micro', tier: 1 }),
      mc('Elasticity measures responsiveness of quantity to', ['price', 'color', 'weather', 'time only'], 0, { sub: 'micro', tier: 2 }),
      mc('A diversified portfolio\'s risk is measured partly by', ['variance', 'weight', 'height', 'color'], 0, { sub: 'portfolio', tier: 2 }),
      mc('Fiscal policy is controlled by the', ['government', 'central bank', 'stock market', 'consumers'], 0, { sub: 'macro', tier: 2 }),
    ],
  },
};

// Every question gets a stable id and its category/level stamped in.
for (const [cat, levels] of Object.entries(BANK)) {
  for (const [level, qs] of Object.entries(levels)) {
    qs.forEach((q) => { q.cat = cat; q.level = level; });
  }
}

export function pool(cat, level) {
  return (BANK[cat] && BANK[cat][level]) || [];
}
