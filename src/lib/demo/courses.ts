import type { DemoCourse } from './types';

/**
 * The demo's other four courses: what a training academy runs besides its technical flagship.
 * Short (three lessons each), with bigger groups: finished ones and running ones.
 */
export const DEMO_COURSES: DemoCourse[] = [
  {
    title: 'Presenting with Confidence',
    slug: 'presenting-with-confidence',
    summary: 'Plan a talk around one message, build slides that help, and handle questions and nerves.',
    outcome: 'a ten-minute talk you can give without notes',
    tags: ['Communication', 'Presenting'],
    publishedDaysAgo: 150,
    arcs: [['Before, during and after the talk', 'From one clear message to a calm answer to the last question.']],
    lessons: [
      {
        arc: 0,
        title: 'Know your one message',
        slug: 'know-your-one-message',
        short: 'Decide what the audience should remember, then build everything around it.',
        md: `Most talks fail before the first slide: they try to say everything. Yours will say one thing well.

## Start from the ending

Write the sentence you want people to repeat to a colleague afterwards. If you can't write it, you aren't ready to make slides.

## One message, three points

Support the message with three points, no more. For each, have one example or story that makes it stick.

## Test it on a colleague

Tell a colleague your message in thirty seconds, then ask them to say it back. **Check your work:** what they repeat is your sentence, not a detail.`,
      },
      {
        arc: 0,
        title: 'Slides that help, not hide',
        slug: 'slides-that-help',
        short: 'One idea per slide, big text, and a rehearsal with a timer.',
        md: `Slides support you; they aren't the talk. If people read them, they stop listening to you.

## One idea per slide

Give every slide one idea, written as a short sentence at the top. A slide with two ideas becomes two slides.

## Big text, few words

Use text people can read from the back of the room, and no more than about twenty words. Put the details in a handout.

## Rehearse with a timer

Run the whole talk out loud with a timer, twice. Cut slides until it fits in the time with a minute to spare.`,
      },
      {
        arc: 0,
        title: 'Handling questions and nerves',
        slug: 'questions-and-nerves',
        short: 'Calm the first minute, repeat questions back, and say when you don\'t know.',
        md: `Nerves and hard questions are normal. A few habits turn them into a strength.

## Breathe before you start

Plant your feet, breathe out slowly, and say your first sentence from memory. The first minute sets the pace for the rest.

## Repeat the question

Repeat each question in your own words before you answer. Everyone hears it, and you get a few seconds to think.

## When you don't know

Say so, and say when you'll follow up. "I don't know yet; I'll send it by Friday" builds more trust than a guess.`,
      },
    ],
    cohorts: [
      {
        name: 'Sales team · Spring 2026', slug: 'sales-spring-2026', size: 20, startDaysAgo: 120, endDaysAgo: 90, answered: 3,
        notYet: [0.1, 0.18, 0.34], hard: { 2: 2 },
        notes: { 2: ['I still freeze when I get a question I can\'t answer', 'How do I stop someone who keeps asking?'] },
        survey: { kind: 'END', share: 0.8, mean: 4.4, improve: [2], helped: ['Rehearsing with a timer changed everything.', 'The one-message exercise before making slides.'], change: ['More practice answering hard questions.'] },
      },
      {
        name: 'Open course · Autumn 2026', slug: 'open-autumn-2026', size: 16, startDaysAgo: 14, endDaysAgo: -16, answered: 2,
        notYet: [0.12, 0.25], hard: { 1: 1 }, notes: { 1: ['Twenty words feels impossible for technical slides'] },
        survey: { kind: 'MID', share: 0.7, mean: 4.1, improve: [1], helped: ['Testing my message on a colleague.'], change: ['Examples from technical talks, please.'] },
      },
    ],
    feedback: [
      {
        lesson: 1, cohort: 1, member: 3,
        passage: 'Use text people can read from the back of the room, and no more than about twenty words.',
        body: 'What about charts and numbers? A sales chart needs labels, and that is more than twenty words.',
        task: { status: 'TODO', plan: null },
      },
    ],
  },
  {
    title: 'Project Management Fundamentals',
    slug: 'project-management-fundamentals',
    summary: 'Agree the scope, plan the work in ranges, and keep a project on track without drama.',
    outcome: 'a one-page plan for a real project of yours',
    tags: ['Management', 'Planning'],
    publishedDaysAgo: 120,
    arcs: [
      ['Setting up', 'What the project is for, and what it is not.'],
      ['Running it', 'Planning the work and keeping it on track.'],
    ],
    lessons: [
      {
        arc: 0,
        title: "Scope: what's in, what's out",
        slug: 'scope-in-and-out',
        short: 'Write the goal in one sentence, list what is out, and agree it in writing.',
        md: `Projects rarely fail on effort. They fail because people had different pictures of the result.

## Write the goal in one sentence

"Customers can book a repair online by June." One sentence, with a result and a date. Everything in the project serves it.

## List what's out

Write down what the project will *not* do. "No payments online in this phase" saves weeks of arguments later.

## Agree it in writing

Send the goal and the out-list to everyone who can say no, and ask them to reply. **Check your work:** every sponsor has answered.`,
      },
      {
        arc: 1,
        title: 'Planning the work',
        slug: 'planning-the-work',
        short: 'Break it into tasks, estimate in ranges, and find the critical path.',
        md: `A plan is a list of tasks, how long they might take, and which ones wait on others.

## Break it into tasks

Break the work down until each task fits in a few days and has one owner. "Build the website" is a goal; "Write the booking form" is a task.

## Estimate in ranges

Ask "between how many and how many days?" instead of for one number. Ranges are honest, and they show where the risk is.

## Find the critical path

Some tasks can only start when others finish. The longest chain of those is the critical path: it sets the end date, and a day lost on it is a day lost for the project.`,
      },
      {
        arc: 1,
        title: 'Keeping it on track',
        slug: 'keeping-it-on-track',
        short: 'A weekly status in five lines, early warnings, and saying no to scope creep.',
        md: `Most of project management is noticing early and saying it plainly.

## A weekly status in five lines

Done this week, next week, risks, decisions needed, and whether the date still holds. Five lines people actually read.

## Spot risks early

Ask each owner every week: "What could stop you?" A risk named in week two is a plan; the same risk found in week ten is a crisis.

## Saying no to scope creep

When someone asks for more, point to the out-list and offer a choice: more time, fewer other things, or a later phase.`,
      },
    ],
    cohorts: [
      {
        name: 'Evening course · Summer 2026', slug: 'evening-summer-2026', size: 24, startDaysAgo: 95, endDaysAgo: 40, answered: 3,
        notYet: [0.12, 0.42, 0.15], hard: { 1: 2 },
        notes: { 1: ['The critical path example went too fast', 'How do I find the critical path in a big project?', 'Ranges make my manager nervous'] },
        survey: { kind: 'END', share: 0.75, mean: 3.9, improve: [1, 1, 2], helped: ['The five-line weekly status. My team loves it.', 'Writing down what is out of scope.'], change: ['A worked example of the critical path.', 'Less theory, more of our own projects.'] },
      },
      {
        name: 'Evening course · Autumn 2026', slug: 'evening-autumn-2026', size: 18, startDaysAgo: 10, endDaysAgo: -45, answered: 1,
        notYet: [0.1], hard: {}, notes: {},
      },
    ],
    feedback: [
      {
        lesson: 1, cohort: 0, member: 5,
        passage: 'The longest chain of those is the critical path: it sets the end date, and a day lost on it is a day lost for the project.',
        body: 'Could we get a worked example with five or six tasks? I followed the definition but could not find it in my own plan.',
        task: { status: 'IN_PROGRESS', plan: 'After "Find the critical path", add a worked example: six tasks of a website project with their days and what each waits on, the chain worked out step by step, and a check: change one task on the chain by two days and see the end date move.' },
      },
    ],
  },
  {
    title: 'Excel for Everyday Analysis',
    slug: 'excel-for-everyday-analysis',
    summary: 'Turn lists into tables, answer questions with formulas, and summarise anything with PivotTables.',
    outcome: 'a monthly report you can refresh in a minute',
    tags: ['Excel', 'Data'],
    publishedDaysAgo: 200,
    arcs: [['From list to answer', 'Tables, formulas and PivotTables, on your own data.']],
    lessons: [
      {
        arc: 0,
        title: 'Tables, not ranges',
        slug: 'tables-not-ranges',
        short: 'Turn data into a table, sort and filter it, and add a totals row.',
        md: `Most spreadsheet trouble starts with data that is just cells. A table knows where your data starts and ends.

## Turn data into a table

Click inside your data and press Ctrl+T. The table grows with new rows, and formulas follow along.

## Sort and filter

Use the arrows in the header row to sort and filter. Nothing is deleted: clear the filter and every row is back.

## A totals row

Turn on the totals row and choose Sum or Average per column. **Check your work:** filter the table and watch the total change.`,
      },
      {
        arc: 0,
        title: 'Formulas that answer questions',
        slug: 'formulas-that-answer-questions',
        short: 'SUMIFS, COUNTIFS and XLOOKUP for the questions you are asked every week.',
        md: `Three formulas answer most questions people ask about a list.

## SUMIFS and COUNTIFS

"How much did we sell in the north in March?" is a SUMIFS: what to add up, then each condition and its value.

## XLOOKUP

XLOOKUP finds a value in one column and returns the matching value from another: a product's price from its code, an employee's team from their name.

## Check your work

Check every new formula on a case you can work out by hand. A formula that is wrong looks exactly as convincing as one that is right.`,
      },
      {
        arc: 0,
        title: 'PivotTables in ten minutes',
        slug: 'pivottables-in-ten-minutes',
        short: 'Summarise thousands of rows by month, region or product, and chart the result.',
        md: `A PivotTable summarises a table without a single formula.

## Your first PivotTable

Insert a PivotTable from your table, drag Region into Rows and Sales into Values. That's a sales report by region.

## Grouping dates

Drag a date into Rows and group it by month or quarter. Monthly trends appear without a helper column.

## A chart from the pivot

Insert a PivotChart: it follows the PivotTable's filters. Refresh the pivot after new data arrives, and both update.`,
      },
    ],
    cohorts: [
      {
        name: 'Finance team · June 2026', slug: 'finance-june-2026', size: 16, startDaysAgo: 130, endDaysAgo: 110, answered: 3,
        notYet: [0.05, 0.3, 0.12], hard: { 1: 1 }, notes: { 1: ['XLOOKUP vs VLOOKUP?', 'My XLOOKUP returns #N/A and I do not see why'] },
        survey: { kind: 'END', share: 0.85, mean: 4.5, improve: [1], helped: ['PivotTables saved me a day a month.', 'Tables instead of ranges, finally.'], change: ['More on fixing #N/A errors.'] },
      },
      {
        name: 'Open course · September 2026', slug: 'open-september-2026', size: 22, startDaysAgo: 45, endDaysAgo: 25, answered: 3,
        notYet: [0.08, 0.36, 0.2], hard: { 1: 1, 2: 1 }, notes: { 1: ['When do I use SUMIFS and when a PivotTable?'], 2: ['Grouping by month did not work on my dates'] },
        survey: { kind: 'END', share: 0.8, mean: 4.2, improve: [1, 2], helped: ['The check-your-work habit for formulas.'], change: ['A cheat sheet with the three formulas.'] },
      },
    ],
    feedback: [
      {
        lesson: 2, cohort: 1, member: 7,
        passage: 'Drag a date into Rows and group it by month or quarter.',
        body: 'Grouping was greyed out for my dates. Turned out some cells were text, not dates. Maybe warn about that?',
      },
    ],
  },
  {
    title: 'Customer Conversations That Work',
    slug: 'customer-conversations',
    summary: 'Listen first, calm an upset customer, and close every conversation with a clear next step.',
    outcome: 'conversations that end with a satisfied customer and a clear next step',
    tags: ['Service', 'Communication'],
    publishedDaysAgo: 90,
    arcs: [['The conversation', 'Opening, the hard middle, and the close.']],
    lessons: [
      {
        arc: 0,
        title: 'Listening first',
        slug: 'listening-first',
        short: 'Let them finish, repeat what you heard, and ask one open question.',
        md: `Customers can tell in the first minute whether you are listening or waiting to talk.

## Let them finish

Don't interrupt, even when you already know the answer. Finishing their story is half of what they called for.

## Repeat what you heard

"So the parcel arrived, but the size is wrong, and you need it by Friday?" Now they know you understood, and you know you did.

## Ask one open question

"What would be the best outcome for you?" One open question tells you more than five yes-or-no ones.`,
      },
      {
        arc: 0,
        title: 'When the customer is upset',
        slug: 'when-the-customer-is-upset',
        short: 'Don\'t take it personally, name the feeling, and offer what you can do.',
        md: `An upset customer is upset with the situation, not with you. Your calm is what turns it around.

## Don't take it personally

Lower your voice and slow down instead of matching their pace. The calmer person in the conversation leads it.

## Name the feeling

"I can hear this has been really frustrating." Naming the feeling often lowers the temperature more than any solution.

## Offer what you can do

Start with what you *can* do, not with policy. "I can send a new one today" lands better than "Our policy says…"`,
      },
      {
        arc: 0,
        title: 'Closing the loop',
        slug: 'closing-the-loop',
        short: 'Summarise the next step, follow up when you said you would, and ask how it went.',
        md: `How a conversation ends is what the customer remembers.

## Summarise the next step

Say who does what by when: "I'm sending a replacement today; it arrives Thursday." Then ask if that works.

## Follow up when you said

If you promised a call on Monday, call on Monday, even if the news isn't ready. Keeping small promises builds trust.

## Ask how it went

A short message after it's solved — "Did the replacement fit?" — turns a complaint into a loyal customer.`,
      },
    ],
    cohorts: [
      {
        name: 'Support team · Q3 2026', slug: 'support-q3-2026', size: 20, startDaysAgo: 70, endDaysAgo: 50, answered: 3,
        notYet: [0.08, 0.28, 0.1], hard: { 1: 2 },
        notes: { 1: ['What if I really cannot offer anything?', 'Naming the feeling sounds fake to me'] },
        survey: { kind: 'END', share: 0.85, mean: 4.6, improve: [1], helped: ['Repeating back what I heard. Calls are shorter now.', 'Starting with what I can do.'], change: ['Role-play with really angry customers.'] },
      },
      {
        name: 'Retail staff · October 2026', slug: 'retail-october-2026', size: 24, startDaysAgo: 18, endDaysAgo: -10, answered: 2,
        notYet: [0.1, 0.3], hard: { 1: 2 }, notes: { 1: ['In the shop the customer is standing in front of me, it is harder'] },
        survey: { kind: 'MID', share: 0.65, mean: 4.3, improve: [1], helped: ['Letting them finish.'], change: ['Examples from the shop floor.'] },
      },
    ],
    feedback: [
      {
        lesson: 1, cohort: 1, member: 4,
        passage: '"I can send a new one today" lands better than "Our policy says…"',
        body: 'Sometimes the honest answer is that I can do nothing. What do I say then?',
      },
    ],
  },
];
