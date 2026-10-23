/**
 * Beside the sign-in form, one at random: something said about learning (only words whose author is
 * on record) or a bit of classroom trivia.
 */
export type LearningNote = { kind: 'quote'; text: string; by: string } | { kind: 'trivia'; text: string };

export const LEARNING_NOTES: LearningNote[] = [
  { kind: 'quote', text: 'While we teach, we learn.', by: 'Seneca, Letters to Lucilius' },
  { kind: 'quote', text: 'What we have to learn to do, we learn by doing.', by: 'Aristotle, Nicomachean Ethics' },
  { kind: 'quote', text: 'Better a well-made head than a well-filled one.', by: 'Michel de Montaigne, Essays' },
  { kind: 'quote', text: 'To teach is to learn twice.', by: 'Joseph Joubert' },
  {
    kind: 'quote',
    text: 'I am always ready to learn, although I do not always like being taught.',
    by: 'Winston Churchill',
  },
  {
    kind: 'quote',
    text: 'Learning is not attained by chance; it must be sought for with ardor and attended to with diligence.',
    by: 'Abigail Adams, in a letter to her son',
  },
  {
    kind: 'quote',
    text: 'A teacher affects eternity; he can never tell where his influence stops.',
    by: 'Henry Adams',
  },
  {
    kind: 'quote',
    text: 'The first principle is that you must not fool yourself, and you are the easiest person to fool.',
    by: 'Richard Feynman',
  },
  { kind: 'quote', text: 'The mind is not a vessel to be filled, but a fire to be kindled.', by: 'after Plutarch, On Listening' },
  {
    kind: 'quote',
    text: 'The greatest sign of success for a teacher… is to be able to say, ‘The children are now working as if I did not exist.’',
    by: 'Maria Montessori',
  },
  { kind: 'trivia', text: '“School” comes from the Greek schole, which meant leisure.' },
  { kind: 'trivia', text: '“Curriculum” is Latin for a race, or the course it is run on.' },
  { kind: 'trivia', text: '“Lecture” comes from the Latin for reading: medieval lecturers read the book aloud.' },
  { kind: 'trivia', text: 'A paidagogos, the first “pedagogue”, was the servant who walked Greek children to their teacher.' },
  { kind: 'trivia', text: '“Syllabus” began as a misprint, in a 15th-century edition of Cicero’s letters.' },
  {
    kind: 'trivia',
    text: 'Seneca grumbled that “we learn not for life but for school”. Schools turned it round for their motto.',
  },
  {
    kind: 'trivia',
    text: 'In 1885 Hermann Ebbinghaus learned thousands of nonsense syllables to chart how fast we forget them.',
  },
  { kind: 'trivia', text: 'Recalling something, as in a quiz, makes it stick better than reading it again.' },
  { kind: 'trivia', text: 'Learners who expect to teach what they study remember it better than those expecting a test.' },
  { kind: 'trivia', text: 'Friedrich Fröbel named his school for small children a Kindergarten: a garden of children.' },
  { kind: 'trivia', text: 'The memory palace goes back to Simonides of Ceos, who, the story goes, recalled a banquet by its seats.' },
  { kind: 'trivia', text: 'Al-Qarawiyyin in Fez, founded by Fatima al-Fihri in 859, is often called the oldest university still teaching.' },
];
