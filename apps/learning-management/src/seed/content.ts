import type { LessonType, QuizQuestion } from '@project/shared/lessons';

/**
 * The demo academy's catalog: Fernwood Supply Co., an outdoor and home goods
 * retailer with stores, a distribution center and a headquarters team.
 *
 * Content is written to read like a real L&D team made it — it is what someone
 * evaluating the template actually reads. Videos are public TED talks; covers
 * are Unsplash photos pinned to a size.
 */

const cover = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&h=675&fit=crop&q=80`;
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const SAMPLE_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

let qn = 0;
const opt = (text: string, correct = false) => ({ id: `o${++qn}`, text, correct });

/** Single choice: the option at `answer` is correct. */
function single(prompt: string, options: string[], answer: number, explanation = ''): QuizQuestion {
  return { id: `q${++qn}`, type: 'single', prompt, options: options.map((o, i) => opt(o, i === answer)), acceptedAnswers: [], explanation, points: 1 };
}
function multiple(prompt: string, options: string[], answers: number[], explanation = ''): QuizQuestion {
  return { id: `q${++qn}`, type: 'multiple', prompt, options: options.map((o, i) => opt(o, answers.includes(i))), acceptedAnswers: [], explanation, points: 1 };
}
function truth(prompt: string, isTrue: boolean, explanation = ''): QuizQuestion {
  return { id: `q${++qn}`, type: 'true_false', prompt, options: [{ id: `o${++qn}`, text: 'True', correct: isTrue }, { id: `o${++qn}`, text: 'False', correct: !isTrue }], acceptedAnswers: [], explanation, points: 1 };
}
function short(prompt: string, accepted: string[], explanation = ''): QuizQuestion {
  return { id: `q${++qn}`, type: 'short', prompt, options: [], acceptedAnswers: accepted, explanation, points: 1 };
}

export type SeedLesson = {
  key: string;
  title: string;
  type: LessonType;
  minutes: number;
  body?: string;
  mediaUrl?: string;
  mediaName?: string;
  settings?: Record<string, unknown>;
  optional?: boolean;
};
export type SeedSection = { title: string; description?: string; lessons: SeedLesson[] };
export type SeedCourse = {
  key: string;
  title: string;
  summary: string;
  description: string;
  objectives: string[];
  cover: string | null;
  icon: string;
  color: string;
  category: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  status: 'Draft' | 'Published' | 'Archived';
  visibility: 'Catalog' | 'Private';
  owner: string;
  instructors?: string[];
  sequential: boolean;
  dueDays: number | null;
  certificate: boolean;
  validityMonths: number | null;
  skills: string[];
  publishedDaysAgo: number;
  sections: SeedSection[];
};

export const CATEGORIES = [
  { key: 'compliance', name: 'Compliance', icon: '🛡️', color: '#34608c', description: 'Required training that keeps our people, customers and company safe.' },
  { key: 'onboarding', name: 'Onboarding', icon: '👋', color: '#1d6f78', description: 'Everything you need in your first weeks at Fernwood.' },
  { key: 'safety', name: 'Safety', icon: '⛑️', color: '#a8730f', description: 'Working safely in our stores and the distribution center.' },
  { key: 'leadership', name: 'Leadership', icon: '🧭', color: '#2e4a70', description: 'For people leaders and anyone growing into the role.' },
  { key: 'sales', name: 'Sales', icon: '📈', color: '#2f6b55', description: 'Selling with curiosity and care, from first call to renewal.' },
  { key: 'customer', name: 'Customer Experience', icon: '💬', color: '#a4445c', description: 'How we make every customer interaction count.' },
  { key: 'skills', name: 'Professional Skills', icon: '✨', color: '#5f7a2c', description: 'Communication, wellbeing and ways of working.' },
];

const phishingBody = `Phishing is still how most breaches start. An attacker doesn't need to break our systems if they can persuade one of us to open the door.

## The four tells

Most phishing messages share at least one of these:

1. **Urgency.** "Your account will be closed in 2 hours." Real teams rarely give you minutes.
2. **An unexpected request.** A gift card purchase, a password, a change of bank details for a supplier.
3. **A sender that's almost right.** \`payroll@fernwood-supply.co\` instead of \`fernwoodsupply.com\`.
4. **A link that goes somewhere else.** Hover (or long-press on your phone) before you tap.

> **Real example, from last spring:** a store manager received a text "from the CFO" asking for eight $200 gift cards for a client event, "and keep it quiet, it's a surprise." It wasn't the CFO.

## What to do

- Don't click, reply or call a number in the message.
- Use **Report phishing** in Outlook, or forward texts to **security@fernwoodsupply.com**.
- If you already clicked or typed a password, tell us straight away. You won't be in trouble — the first hour matters more than anything else.`;

const passwordsBody = `## Passphrases beat passwords

Length matters more than complexity. \`river-lantern-oatmeal-42\` is far harder to crack than \`P@ssw0rd!\` and much easier to remember.

- Use a **different passphrase for every system**. Our password manager (1Password) remembers them for you.
- Never share a passphrase — not with IT, not with your manager. We will never ask for it.

## Multi-factor authentication

MFA means a stolen password alone isn't enough. Every Fernwood account uses the **Okta Verify** app.

| If you see… | Do this |
| --- | --- |
| A push you didn't trigger | Tap **Deny**, then report it |
| Repeated pushes late at night | Deny every one and call the service desk |
| A request to read out a code | Hang up. We never ask for codes |

## Locking up

Lock your screen when you step away (⊞ + L or ⌃ ⌘ Q), and keep devices with you when you travel.`;

const securityWhy = `Every one of us handles something worth protecting: customer addresses and orders, supplier contracts, payroll, the point-of-sale systems in our stores.

In the last year retailers of our size saw, on average, **a phishing attempt every working day** and a successful account takeover roughly once a quarter. The difference between an incident and a near miss is almost always a person who noticed something odd and said so.

This course takes about 25 minutes. You'll learn to spot the most common attacks, protect your accounts, and know exactly what to do when something feels wrong.`;

export const COURSES: SeedCourse[] = [
  {
    key: 'security',
    title: 'Security Awareness Essentials',
    summary: 'Spot phishing, protect your accounts and know what to do when something looks wrong.',
    description:
      'Our annual security training for everyone at Fernwood. It covers the attacks we actually see — phishing emails and texts, fake invoices, MFA fatigue — and the handful of habits that stop them.\n\nComplete it once a year to keep your certification current.',
    objectives: ['Recognise the four tells of a phishing message', 'Create strong passphrases and use MFA safely', 'Report a suspected incident in under a minute'],
    cover: cover('1563986768609-322da13575f3'),
    icon: '🔐',
    color: '#34608c',
    category: 'compliance',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Private',
    owner: 'aisha',
    sequential: true,
    dueDays: 30,
    certificate: true,
    validityMonths: 12,
    skills: ['Security', 'Phishing awareness', 'Data protection'],
    publishedDaysAgo: 400,
    sections: [
      {
        title: 'Why security matters',
        lessons: [{ key: 'sec-why', title: 'What we protect, and who from', type: 'Article', minutes: 4, body: securityWhy }],
      },
      {
        title: 'Everyday threats',
        lessons: [
          { key: 'sec-phishing', title: 'Spotting phishing', type: 'Article', minutes: 7, body: phishingBody },
          { key: 'sec-passwords', title: 'Passphrases and MFA', type: 'Article', minutes: 6, body: passwordsBody },
          {
            key: 'sec-habits',
            title: 'Secure your setup',
            type: 'Checklist',
            minutes: 5,
            body: 'Take five minutes to check your own setup now. Tick each item once it’s done.',
            settings: { items: [{ id: 'c1', text: 'Installed 1Password and saved my work logins' }, { id: 'c2', text: 'Okta Verify is set up on my phone' }, { id: 'c3', text: 'My laptop locks after 5 minutes' }, { id: 'c4', text: 'I know where the Report phishing button is' }] },
          },
        ],
      },
      {
        title: 'Check your knowledge',
        lessons: [
          {
            key: 'sec-quiz',
            title: 'Security knowledge check',
            type: 'Quiz',
            minutes: 6,
            body: 'Six questions. You need 80% to pass, and you can retake it up to three times.',
            settings: {
              questions: [
                single('A text "from the CFO" asks you to buy gift cards for a client event and keep it quiet. What do you do?', ['Buy them — it is the CFO', 'Reply to ask which client', 'Report it without replying', 'Forward it to your team to check'], 2, 'Urgency, secrecy and gift cards are three tells at once. Report it; never reply.'),
                truth('It is fine to approve an MFA push you didn’t trigger if it stops the notifications.', false, 'Approving an unexpected push lets an attacker in. Deny it and report it.'),
                multiple('Which of these are signs of phishing? Choose all that apply.', ['A sender address that is almost right', 'A deadline measured in hours', 'A request to change a supplier’s bank details', 'An email from a colleague you work with every day about a shared project'], [0, 1, 2]),
                single('Which is the strongest password?', ['Fernwood2026!', 'P@ssw0rd#1', 'river-lantern-oatmeal-42', 'fw_admin'], 2, 'Length beats complexity. Four random words are very hard to guess.'),
                short('Which email address do you forward suspicious texts to? (just the part before the @)', ['security', 'security@fernwoodsupply.com'], 'security@fernwoodsupply.com'),
                truth('If you clicked a bad link, you should wait to see if anything happens before telling anyone.', false, 'The first hour matters most. Tell us straight away — you won’t be in trouble.'),
              ],
              passingScore: 80,
              maxAttempts: 3,
              shuffleQuestions: false,
              revealAnswers: 'after_submit',
              timeLimitMinutes: null,
            },
          },
        ],
      },
    ],
  },
  {
    key: 'conduct',
    title: 'Code of Conduct & Ethics',
    summary: 'How we do business: honesty, fairness and speaking up when something isn’t right.',
    description: 'Read and acknowledge our Code of Conduct. It explains what we expect of each other, what to do about conflicts of interest and gifts, and how to raise a concern safely.',
    objectives: ['Apply the Code to everyday decisions', 'Handle gifts and conflicts of interest', 'Know every way to speak up — including anonymously'],
    cover: cover('1450101499163-c8848c66ca85'),
    icon: '📜',
    color: '#34608c',
    category: 'compliance',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Private',
    owner: 'maya',
    sequential: false,
    dueDays: 30,
    certificate: true,
    validityMonths: 12,
    skills: ['Ethics', 'Compliance'],
    publishedDaysAgo: 330,
    sections: [
      {
        title: 'The Code',
        lessons: [
          {
            key: 'coc-values',
            title: 'Our values in practice',
            type: 'Article',
            minutes: 5,
            body: `The Code isn’t a rulebook for every situation. It’s a way of deciding. When you’re unsure, ask:\n\n- **Is it legal, and does it follow our policies?**\n- **Would I be comfortable if it were on the front page of the local paper?**\n- **Does it treat customers, colleagues and suppliers fairly?**\n\nIf any answer is "no" or "I'm not sure", pause and ask your manager or the People team.\n\n## Gifts and hospitality\n\nYou can accept modest gifts (under $75) that are occasional and not tied to a decision you're making. Anything more, or anything from a supplier in an active negotiation, gets declined politely and logged in the gifts register.\n\n## Conflicts of interest\n\nA conflict exists when your personal interests could influence — or look like they influence — a decision at work. Hiring a relative, owning shares in a supplier, or a side business that competes with ours all need to be disclosed. Disclosing isn't an admission of wrongdoing; hiding it is.`,
          },
          { key: 'coc-pdf', title: 'Read the full Code of Conduct', type: 'File', minutes: 12, body: 'The complete Code, 2026 edition. Keep it handy — you can download it for later.', mediaUrl: SAMPLE_PDF, mediaName: 'Fernwood Code of Conduct 2026.pdf' },
          {
            key: 'coc-speakup',
            title: 'Speaking up',
            type: 'Article',
            minutes: 3,
            body: `You can raise a concern with:\n\n1. Your manager, or their manager\n2. The People team at **people@fernwoodsupply.com**\n3. **Fernwood Speak Up**, our independent hotline — by phone or web, anonymously if you prefer\n\nWe do not tolerate retaliation against anyone who raises a concern in good faith. Retaliation is itself a breach of the Code.`,
          },
        ],
      },
      {
        title: 'Acknowledge',
        lessons: [
          {
            key: 'coc-quiz',
            title: 'Scenarios',
            type: 'Quiz',
            minutes: 5,
            settings: {
              questions: [
                single('A supplier you’re renegotiating with sends a $300 bottle of wine. What do you do?', ['Keep it — it’s a thank-you', 'Share it with the team', 'Decline politely and log it in the gifts register', 'Accept it after the negotiation ends'], 2),
                truth('Disclosing a possible conflict of interest means you did something wrong.', false, 'Disclosing is exactly what we ask. Hiding a conflict is the problem.'),
                multiple('Which are ways to raise a concern?', ['Your manager', 'The People team', 'Fernwood Speak Up hotline', 'Posting about it on social media'], [0, 1, 2]),
              ],
              passingScore: 100,
              maxAttempts: 0,
              shuffleQuestions: true,
              revealAnswers: 'after_submit',
              timeLimitMinutes: null,
            },
          },
        ],
      },
    ],
  },
  {
    key: 'respect',
    title: 'Respect at Work',
    summary: 'Recognise, prevent and respond to harassment and discrimination.',
    description: 'Required every two years for everyone, with an extra module for people leaders on responding to reports.',
    objectives: ['Recognise harassment, including less obvious forms', 'Intervene safely as a bystander', 'Respond to a report as a manager'],
    cover: cover('1600880292203-757bb62b4baf'),
    icon: '🤝',
    color: '#1d6f78',
    category: 'compliance',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Private',
    owner: 'maya',
    sequential: false,
    dueDays: 45,
    certificate: true,
    validityMonths: 24,
    skills: ['Inclusion', 'Compliance'],
    publishedDaysAgo: 250,
    sections: [
      {
        title: 'Understanding harassment',
        lessons: [
          {
            key: 'res-what',
            title: 'What harassment looks like',
            type: 'Article',
            minutes: 6,
            body: `Harassment is unwelcome conduct related to a protected characteristic that creates an intimidating, hostile or offensive environment. It doesn't need to be intended, and it doesn't need to be repeated to count.\n\n## It isn't always obvious\n\n- "Jokes" about someone's accent, age or religion\n- Repeatedly asking a colleague out after they've said no\n- Leaving someone out of team events because of who they are\n- Comments about appearance, in person or in a group chat\n\n## The bystander's 4 Ds\n\n**Direct** — say something in the moment, if it's safe. **Distract** — interrupt ("Hey, can you help me with this?"). **Delegate** — ask a manager or colleague to step in. **Delay** — check in with the person afterwards and offer support.`,
          },
          { key: 'res-video', title: 'The power of vulnerability', type: 'Video', minutes: 20, body: 'Why psychological safety starts with how we show up for each other. Watch, then think about one moment this week you could have made space for someone.', mediaUrl: yt('iCvmsMzlF7o') },
        ],
      },
      {
        title: 'Taking action',
        lessons: [
          {
            key: 'res-quiz',
            title: 'What would you do?',
            type: 'Quiz',
            minutes: 5,
            settings: {
              questions: [
                single('In a team chat, a colleague keeps posting jokes about another teammate’s religion. Others react with laughing emoji. What’s a good first step?', ['Leave the chat', 'Reply in the chat that it isn’t okay, or message a manager', 'Add a laughing emoji so you don’t stand out', 'Wait until the next performance review'], 1),
                truth('Harassment only counts if the person meant to offend.', false, 'Impact matters, not intent.'),
                multiple('Which are examples of the 4 Ds?', ['Direct', 'Distract', 'Delegate', 'Deny'], [0, 1, 2]),
              ],
              passingScore: 80,
              maxAttempts: 0,
              shuffleQuestions: false,
              revealAnswers: 'after_submit',
              timeLimitMinutes: null,
            },
          },
        ],
      },
    ],
  },
  {
    key: 'welcome',
    title: 'Welcome to Fernwood',
    summary: 'Our story, how we work, and a practical first-week checklist.',
    description: 'Start here. In under an hour you’ll learn where Fernwood came from, what we care about, how to find your way around our tools, and who to ask for what.',
    objectives: ['Explain what makes Fernwood different', 'Set up the tools you’ll use every day', 'Know who to go to for help'],
    cover: cover('1522202176988-66273c2fd55f'),
    icon: '🌲',
    color: '#2f6b55',
    category: 'onboarding',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Catalog',
    owner: 'daniel',
    sequential: false,
    dueDays: 14,
    certificate: false,
    validityMonths: null,
    skills: ['Company knowledge'],
    publishedDaysAgo: 520,
    sections: [
      {
        title: 'Our story',
        lessons: [
          {
            key: 'wel-story',
            title: 'From one store to forty',
            type: 'Article',
            minutes: 5,
            body: `Fernwood started in 1998 as a single hardware and camping store in Duluth, run by two siblings who thought a good store should feel like a well-organised shed: everything where you'd expect it, and someone around who's actually used the thing you're buying.\n\nToday we're forty stores across the Midwest, a distribution center in Joliet, and a headquarters team in Chicago — about 1,100 people. The idea hasn't changed.\n\n## What we care about\n\n- **Know the product.** Every store colleague spends a day a quarter using what we sell.\n- **Fix it for the customer.** You're trusted to make it right, up to $250, without asking.\n- **Leave it better.** For every $100 of profit, $3 goes to the trails and parks near our stores.`,
          },
          { key: 'wel-why', title: 'Start with why', type: 'Video', minutes: 18, body: 'Our founders often point new hires to this talk. As you watch, think about the "why" behind the work you’ll do here.', mediaUrl: yt('u4ZoJKF_VuA') },
        ],
      },
      {
        title: 'Getting set up',
        lessons: [
          {
            key: 'wel-tools',
            title: 'Your everyday tools',
            type: 'Article',
            minutes: 4,
            body: `| Tool | What it's for | Where to get help |\n| --- | --- | --- |\n| **Okta** | One sign-in for everything | IT service desk |\n| **Slack** | Day-to-day conversations | #help-slack |\n| **Workday** | Pay, time off, benefits | people@fernwoodsupply.com |\n| **Fernwood Academy** | This! Your training | #learning |\n| **Register+** | Point of sale in stores | Your store lead |\n\nStuck on day one? Post in **#new-hires** — someone replies within minutes.`,
          },
          {
            key: 'wel-checklist',
            title: 'First-week checklist',
            type: 'Checklist',
            minutes: 20,
            body: 'Work through these during your first week. Your manager can see your progress.',
            settings: { items: [{ id: 'w1', text: 'Signed in to Okta and set up Okta Verify' }, { id: 'w2', text: 'Completed my Workday profile and emergency contact' }, { id: 'w3', text: 'Joined #new-hires and introduced myself' }, { id: 'w4', text: 'Had a first 1:1 with my manager' }, { id: 'w5', text: 'Met my onboarding buddy' }, { id: 'w6', text: 'Read the Code of Conduct' }] },
          },
          { key: 'wel-live', title: 'New hire welcome breakfast', type: 'Live session', minutes: 60, body: 'Meet the founders and other new starters over breakfast. Pick a date that works for you.' },
        ],
      },
    ],
  },
  {
    key: 'warehouse',
    title: 'Warehouse Safety Fundamentals',
    summary: 'PPE, safe lifting, forklift zones and reporting hazards in the distribution center.',
    description: 'Required before your first shift on the distribution center floor and every year after. Includes a practical walkaround and a hazard report reviewed by the EHS team.',
    objectives: ['Choose the right PPE for each zone', 'Lift safely and know when to ask for help', 'Stay safe around forklifts and conveyors', 'Report a hazard the right way'],
    cover: cover('1586528116311-ad8dd3c8310d'),
    icon: '📦',
    color: '#a8730f',
    category: 'safety',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Private',
    owner: 'tom',
    sequential: true,
    dueDays: 14,
    certificate: true,
    validityMonths: 12,
    skills: ['Workplace safety', 'Warehouse operations'],
    publishedDaysAgo: 600,
    sections: [
      {
        title: 'Before you step on the floor',
        lessons: [
          {
            key: 'wh-ppe',
            title: 'Personal protective equipment',
            type: 'Article',
            minutes: 5,
            body: `| Zone | Required PPE |\n| --- | --- |\n| Receiving and dock | Safety shoes, hi-vis vest, cut-resistant gloves |\n| Pick aisles | Safety shoes, hi-vis vest |\n| Conveyor and sortation | Safety shoes, hi-vis vest, hearing protection, no loose clothing |\n| Battery charging | Safety shoes, face shield, acid-resistant gloves |\n\nPPE is issued free at the security desk. **If yours is damaged, replace it before your shift, not after.**`,
          },
          {
            key: 'wh-lifting',
            title: 'Lifting without injury',
            type: 'Article',
            minutes: 5,
            body: `Most injuries in our DC aren't dramatic. They're backs and shoulders, from lifts that seemed fine.\n\n1. **Test the load.** Tip a corner. Over 23 kg (50 lb)? Use a lift assist or ask for a team lift.\n2. **Get close.** Feet shoulder-width apart, load between your knees.\n3. **Lift with your legs.** Back straight, chin up.\n4. **Don't twist.** Move your feet to turn.\n5. **Set it down the same way.**`,
          },
          {
            key: 'wh-forklift',
            title: 'Forklift and pedestrian zones',
            type: 'Article',
            minutes: 4,
            body: `Pedestrian walkways are marked **green**; forklift aisles **yellow**. Only cross at marked crossings, and make eye contact with the driver before you do.\n\nNever walk under a raised load, ride on a forklift, or use a phone while walking in a yellow aisle.`,
          },
        ],
      },
      {
        title: 'On shift',
        lessons: [
          {
            key: 'wh-walk',
            title: 'Pre-shift walkaround',
            type: 'Checklist',
            minutes: 10,
            body: 'Do this walkaround with your team lead on your first shift.',
            settings: { items: [{ id: 'k1', text: 'Located the nearest fire exit and assembly point' }, { id: 'k2', text: 'Found the first aid station and eyewash' }, { id: 'k3', text: 'Checked my PPE for my zone' }, { id: 'k4', text: 'Walked the green pedestrian route to my station' }] },
          },
          {
            key: 'wh-report',
            title: 'Hazard spotting report',
            type: 'Assignment',
            minutes: 20,
            body: `Walk your area and find **one real hazard** — something that could hurt someone if left alone.\n\nWrite a short report:\n\n1. Where it is (aisle, dock door or station)\n2. What the hazard is and who could be hurt\n3. What you did straight away, if anything\n4. What would fix it for good\n\nA photo helps if it's safe to take one.`,
            settings: { submissionType: 'text_and_file', passingGrade: 70, rubric: 'Pass if the report names a specific location and a credible hazard, and proposes a reasonable fix. Coach rather than fail on writing quality.' },
          },
          {
            key: 'wh-quiz',
            title: 'Safety certification quiz',
            type: 'Quiz',
            minutes: 8,
            settings: {
              questions: [
                single('What colour marks pedestrian walkways?', ['Yellow', 'Green', 'Red', 'Blue'], 1),
                single('A box is heavier than 23 kg (50 lb). What should you do?', ['Lift it quickly to get it over with', 'Use a lift assist or ask for a team lift', 'Drag it', 'Leave it for the next shift'], 1),
                multiple('Which PPE is required at the conveyor and sortation zone?', ['Safety shoes', 'Hi-vis vest', 'Hearing protection', 'Face shield'], [0, 1, 2]),
                truth('It’s acceptable to walk under a raised load if you’re quick.', false),
                truth('Damaged PPE should be replaced before your shift starts.', true),
              ],
              passingScore: 80,
              maxAttempts: 3,
              shuffleQuestions: true,
              revealAnswers: 'after_pass',
              timeLimitMinutes: 15,
            },
          },
        ],
      },
    ],
  },
  {
    key: 'selling',
    title: 'Consultative Selling',
    summary: 'Discovery questions, listening well and proposing the right solution for B2B accounts.',
    description: 'For our commercial accounts team. Learn to lead with questions, listen for what the customer actually needs, and propose fewer, better-fitting solutions.',
    objectives: ['Run a structured discovery conversation', 'Use active listening to uncover needs', 'Write a proposal anchored in the customer’s goals'],
    cover: cover('1521791136064-7986c2920216'),
    icon: '🎯',
    color: '#2f6b55',
    category: 'sales',
    level: 'Intermediate',
    status: 'Published',
    visibility: 'Catalog',
    owner: 'sofia',
    sequential: false,
    dueDays: 30,
    certificate: true,
    validityMonths: null,
    skills: ['Discovery', 'Active listening', 'Negotiation'],
    publishedDaysAgo: 180,
    sections: [
      {
        title: 'Listening first',
        lessons: [
          { key: 'sel-speak', title: 'How to speak so people want to listen', type: 'Video', minutes: 10, body: 'Great discovery is as much about how you speak as what you ask. Notice the "HAIL" principles.', mediaUrl: yt('eIho2S0ZahI') },
          {
            key: 'sel-discovery',
            title: 'The discovery framework',
            type: 'Article',
            minutes: 8,
            body: `A good discovery call is 70% them, 30% you. We use **SPIN**:\n\n- **Situation** — "Walk me through how you stock your locations today."\n- **Problem** — "Where does that break down?"\n- **Implication** — "What happens when a store runs out before a holiday weekend?"\n- **Need-payoff** — "If replenishment were automatic, what would that free your team to do?"\n\nWrite down their words, not your summary. You'll use their language in the proposal.`,
          },
        ],
      },
      {
        title: 'Putting it into practice',
        lessons: [
          {
            key: 'sel-plan',
            title: 'Your discovery call plan',
            type: 'Assignment',
            minutes: 30,
            body: 'Pick a real account you’re working on. Write the 8–10 questions you’ll ask in your next discovery call, grouped by SPIN stage, and note what you hope to learn from each.',
            settings: { submissionType: 'text', passingGrade: 75, rubric: 'Look for questions in all four SPIN stages, open rather than yes/no, and specific to the account. Suggest one sharper implication question in feedback.' },
          },
          {
            key: 'sel-quiz',
            title: 'Discovery quiz',
            type: 'Quiz',
            minutes: 5,
            settings: {
              questions: [
                single('Roughly how much of a discovery call should the customer be talking?', ['30%', '50%', '70%', '90%'], 2),
                single('"What happens when a store runs out before a holiday weekend?" is which kind of SPIN question?', ['Situation', 'Problem', 'Implication', 'Need-payoff'], 2),
                short('What does the "S" in SPIN stand for?', ['situation']),
              ],
              passingScore: 70,
              maxAttempts: 0,
              shuffleQuestions: false,
              revealAnswers: 'after_submit',
              timeLimitMinutes: null,
            },
          },
        ],
      },
    ],
  },
  {
    key: 'service',
    title: 'Customer Service at the Counter',
    summary: 'Turn a frustrated customer into a loyal one with the LAST method.',
    description: 'For store and support colleagues. Short, practical and scenario-based.',
    objectives: ['Use Listen, Apologise, Solve, Thank', 'Read and use body language', 'Know when and how to escalate'],
    cover: cover('1556745757-8d76bdb6984b'),
    icon: '🛎️',
    color: '#a4445c',
    category: 'customer',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Catalog',
    owner: 'daniel',
    instructors: ['sofia'],
    sequential: false,
    dueDays: 21,
    certificate: false,
    validityMonths: null,
    skills: ['Customer service', 'De-escalation'],
    publishedDaysAgo: 300,
    sections: [
      {
        title: 'The LAST method',
        lessons: [
          {
            key: 'svc-last',
            title: 'Listen, Apologise, Solve, Thank',
            type: 'Article',
            minutes: 6,
            body: `**Listen.** Let them finish. Nod, make eye contact, and don't plan your reply while they talk.\n\n**Apologise.** You're apologising for their experience, not admitting fault: "I'm sorry this tent arrived with a broken pole."\n\n**Solve.** Offer a choice where you can: a replacement today, or a refund. Remember you can fix things up to $250 without asking.\n\n**Thank.** "Thanks for bringing it back to us — it helps us catch these."`,
          },
          { key: 'svc-body', title: 'Your body language shapes who you are', type: 'Video', minutes: 21, body: 'Posture changes how others read you — and how you feel. Useful before a tough conversation.', mediaUrl: yt('Ks-_Mh1QhMc'), optional: true },
          { key: 'svc-live', title: 'Live Q&A: Handling difficult customers', type: 'Live session', minutes: 45, body: 'Bring your hardest real-life examples. We’ll role-play a few together.' },
        ],
      },
      {
        title: 'Scenarios',
        lessons: [
          {
            key: 'svc-quiz',
            title: 'What would you say?',
            type: 'Quiz',
            minutes: 5,
            settings: {
              questions: [
                single('A customer’s kayak has a crack. They’re upset and talking loudly. What comes first?', ['Explain the warranty policy', 'Let them finish and listen', 'Call your manager', 'Offer a discount'], 1),
                truth('Apologising for a customer’s experience means admitting the company did something wrong.', false),
                single('Up to what amount can you fix a problem without asking?', ['$50', '$100', '$250', '$500'], 2),
              ],
              passingScore: 70,
              maxAttempts: 0,
              shuffleQuestions: false,
              revealAnswers: 'after_submit',
              timeLimitMinutes: null,
            },
          },
        ],
      },
    ],
  },
  {
    key: 'feedback',
    title: 'Giving and Receiving Feedback',
    summary: 'Use the SBI model to give feedback that’s specific, kind and useful.',
    description: 'Part of Manager Essentials, and open to anyone who wants to get better at feedback conversations.',
    objectives: ['Structure feedback with Situation–Behavior–Impact', 'Receive feedback without getting defensive', 'Make feedback a habit, not an event'],
    cover: cover('1552664730-d307ca884978'),
    icon: '💬',
    color: '#2e4a70',
    category: 'leadership',
    level: 'Intermediate',
    status: 'Published',
    visibility: 'Catalog',
    owner: 'maya',
    instructors: ['daniel'],
    sequential: false,
    dueDays: 30,
    certificate: false,
    validityMonths: null,
    skills: ['Feedback', 'Coaching', 'Communication'],
    publishedDaysAgo: 210,
    sections: [
      {
        title: 'Feedback that lands',
        lessons: [
          {
            key: 'fb-sbi',
            title: 'The SBI model',
            type: 'Article',
            minutes: 6,
            body: `**Situation** — anchor it in a specific moment. "In Tuesday's inventory meeting…"\n\n**Behavior** — describe what you observed, not what you assume. "…you interrupted Ana twice while she was presenting the numbers…"\n\n**Impact** — share the effect. "…and she didn't finish her recommendation, so we left without a decision."\n\nThen stop and ask: *"How did it look from your side?"*\n\n### Positive feedback uses the same shape\n\n"When the delivery was late on Saturday (S), you called every affected customer before they called us (B). Three of them mentioned it in reviews (I)."`,
          },
          { key: 'fb-video', title: 'The power of vulnerability', type: 'Video', minutes: 20, body: 'Receiving feedback well starts with being willing to hear it.', mediaUrl: yt('iCvmsMzlF7o'), optional: true },
        ],
      },
      {
        title: 'Practice',
        lessons: [
          {
            key: 'fb-write',
            title: 'Write one piece of SBI feedback',
            type: 'Assignment',
            minutes: 15,
            body: 'Think of a real moment from the past two weeks — positive or constructive. Write the feedback you’d give using Situation, Behavior and Impact, and the question you’d ask afterwards.',
            settings: { submissionType: 'text', passingGrade: 70, rubric: 'Pass when all three SBI parts are present, the behavior is observable (not a judgement), and a follow-up question is included.' },
          },
          { key: 'fb-lab', title: 'Feedback practice lab', type: 'Live session', minutes: 60, body: 'Practise with other managers in small groups, with a facilitator.', optional: true },
        ],
      },
    ],
  },
  {
    key: 'oneonones',
    title: 'Running Effective 1:1s',
    summary: 'Make one-to-ones the most useful 30 minutes of your team’s week.',
    description: 'A practical guide for people leaders, with an agenda template and a checklist to use before every 1:1.',
    objectives: ['Let your report own the agenda', 'Balance tactical updates with growth conversations', 'Follow through between 1:1s'],
    cover: cover('1517245386807-bb43f82c33c4'),
    icon: '🗓️',
    color: '#2e4a70',
    category: 'leadership',
    level: 'Intermediate',
    status: 'Published',
    visibility: 'Catalog',
    owner: 'daniel',
    sequential: false,
    dueDays: 30,
    certificate: false,
    validityMonths: null,
    skills: ['Coaching', 'People management'],
    publishedDaysAgo: 160,
    sections: [
      {
        title: 'The basics',
        lessons: [
          {
            key: 'oo-guide',
            title: 'Their meeting, not yours',
            type: 'Article',
            minutes: 6,
            body: `A 1:1 is your report's time. Status updates belong in Slack.\n\n## A simple agenda\n\n1. **How are you, really?** (5 min)\n2. **Their topics** (15 min) — they add these beforehand\n3. **Your topics** (5 min)\n4. **Growth** (5 min, monthly) — one thing they want to get better at\n\nWrite down what you each commit to, and start the next 1:1 by checking in on it.`,
          },
          { key: 'oo-motivation', title: 'The puzzle of motivation', type: 'Video', minutes: 19, body: 'Autonomy, mastery and purpose — and what they mean for how you run 1:1s.', mediaUrl: yt('rrkrvAUbU9Y') },
          {
            key: 'oo-check',
            title: 'Before every 1:1',
            type: 'Checklist',
            minutes: 5,
            settings: { items: [{ id: 'p1', text: 'Re-read notes and commitments from last time' }, { id: 'p2', text: 'Checked their agenda items' }, { id: 'p3', text: 'Blocked distractions — laptop closed or notifications off' }, { id: 'p4', text: 'Have one piece of specific, positive feedback ready' }] },
          },
        ],
      },
    ],
  },
  {
    key: 'wellbeing',
    title: 'Managing Stress and Energy',
    summary: 'Science-backed ways to handle pressure, beat procrastination and protect your energy.',
    description: 'Two great talks and a few small experiments to try this week. The last course in Manager Essentials, and open to anyone in the catalog.',
    objectives: ['Reframe stress as a resource', 'Understand why we procrastinate', 'Try two small energy habits this week'],
    cover: cover('1434030216411-0b793f4b4173'),
    icon: '🌿',
    color: '#5f7a2c',
    category: 'skills',
    level: 'Beginner',
    status: 'Published',
    visibility: 'Catalog',
    owner: 'maya',
    sequential: false,
    dueDays: null,
    certificate: false,
    validityMonths: null,
    skills: ['Wellbeing', 'Productivity'],
    publishedDaysAgo: 120,
    sections: [
      {
        title: 'Talks',
        lessons: [
          { key: 'wb-stress', title: 'How to make stress your friend', type: 'Video', minutes: 15, mediaUrl: yt('RcGyVTAoXEU'), body: 'How you think about stress changes how your body responds to it.' },
          { key: 'wb-procrastinate', title: 'Inside the mind of a master procrastinator', type: 'Video', minutes: 14, mediaUrl: yt('arj7oStGLkU'), body: 'Funny, and uncomfortably accurate.' },
        ],
      },
      {
        title: 'Try it',
        lessons: [
          {
            key: 'wb-experiments',
            title: 'Two experiments for this week',
            type: 'Checklist',
            minutes: 10,
            body: 'Pick any two. Small is the point.',
            settings: { items: [{ id: 'e1', text: 'Took a 10-minute walk outside at lunch, three days this week' }, { id: 'e2', text: 'Blocked one 90-minute focus session in my calendar' }, { id: 'e3', text: 'Wrote tomorrow’s top three tasks before logging off' }, { id: 'e4', text: 'Turned off non-urgent notifications for a day' }] },
          },
        ],
      },
    ],
  },
  {
    key: 'privacy',
    title: 'Handling Customer Data',
    summary: 'Privacy basics for anyone who handles customer orders, addresses or payment details.',
    description: 'New for 2027 — being written with Legal. Not yet published.',
    objectives: ['Know what counts as personal data', 'Handle data subject requests', 'Keep payment data out of email and chat'],
    cover: cover('1454165804606-c3d57bc86b40'),
    icon: '🗂️',
    color: '#34608c',
    category: 'compliance',
    level: 'Beginner',
    status: 'Draft',
    visibility: 'Private',
    owner: 'aisha',
    sequential: false,
    dueDays: 30,
    certificate: true,
    validityMonths: 12,
    skills: ['Privacy', 'Data protection'],
    publishedDaysAgo: 0,
    sections: [
      {
        title: 'Personal data',
        lessons: [
          { key: 'pr-what', title: 'What counts as personal data', type: 'Article', minutes: 5, body: `Personal data is anything that identifies a person, directly or combined with other information: names, email addresses, delivery addresses, order history, loyalty numbers, IP addresses.\n\n_Draft — examples from the stores team to come._` },
          { key: 'pr-requests', title: 'Handling a deletion request', type: 'Article', minutes: 4, body: '' },
        ],
      },
    ],
  },
  {
    key: 'pos',
    title: 'Register+ Point of Sale (2024)',
    summary: 'The old register system. Replaced by Register+ Cloud in 2026.',
    description: 'Archived when stores moved to Register+ Cloud. Kept for learners’ records.',
    objectives: ['Ring up sales and returns', 'Close out a shift'],
    // No photo: the archived course shows the lettered cover every course without one gets.
    cover: null,
    icon: '🧾',
    color: '#5b5650',
    category: 'onboarding',
    level: 'Beginner',
    status: 'Archived',
    visibility: 'Private',
    owner: 'daniel',
    sequential: false,
    dueDays: 7,
    certificate: false,
    validityMonths: null,
    skills: ['Store operations'],
    publishedDaysAgo: 900,
    sections: [
      {
        title: 'Register basics',
        lessons: [
          { key: 'pos-sales', title: 'Sales and returns', type: 'Article', minutes: 6, body: 'Scan, confirm the total, take payment. For returns, scan the receipt barcode first.' },
          { key: 'pos-close', title: 'Closing out a shift', type: 'Article', minutes: 4, body: 'Count the drawer, print the Z report and file it in the safe.' },
        ],
      },
    ],
  },
];

export const PATHS = [
  {
    key: 'onboarding',
    title: 'New Hire Onboarding',
    summary: 'Your first 30 days at Fernwood: culture, tools and the essentials we ask of everyone.',
    description: 'Four courses to take in order. Most people finish within two weeks.',
    cover: cover('1497366216548-37526070297c'),
    icon: '🧭',
    color: '#1d6f78',
    category: 'onboarding',
    status: 'Published' as const,
    visibility: 'Private' as const,
    owner: 'daniel',
    sequential: true,
    dueDays: 30,
    certificate: true,
    validityMonths: null,
    courses: ['welcome', 'security', 'conduct', 'respect'],
  },
  {
    key: 'managers',
    title: 'Manager Essentials',
    summary: 'The core skills for new people leaders: feedback, 1:1s and looking after your energy.',
    description: 'For anyone who manages people at Fernwood. Take the courses in order; the optional practice lab runs monthly.',
    cover: cover('1542744173-8e7e53415bb0'),
    icon: '🧑‍🏫',
    color: '#2e4a70',
    category: 'leadership',
    status: 'Published' as const,
    visibility: 'Catalog' as const,
    owner: 'maya',
    sequential: true,
    dueDays: 60,
    certificate: true,
    validityMonths: null,
    courses: ['feedback', 'oneonones', 'wellbeing'],
  },
  {
    key: 'dc',
    title: 'Distribution Center Certification',
    summary: 'Required safety and security certification for everyone working in the Joliet DC.',
    description: 'Renew every year. Your certificate is checked at badge pickup.',
    cover: cover('1581092580497-e0d23cbdf1dc'),
    icon: '🏗️',
    color: '#a8730f',
    category: 'safety',
    status: 'Published' as const,
    visibility: 'Private' as const,
    owner: 'tom',
    sequential: false,
    dueDays: 14,
    certificate: true,
    validityMonths: 12,
    courses: ['warehouse', 'security'],
  },
  {
    key: 'sales',
    title: 'Sales Onboarding',
    summary: 'From first day to first proposal on the commercial accounts team.',
    description: 'A draft path being piloted with the next sales cohort.',
    cover: cover('1556761175-5973dc0f32e7'),
    icon: '📈',
    color: '#2f6b55',
    category: 'sales',
    status: 'Draft' as const,
    visibility: 'Private' as const,
    owner: 'sofia',
    sequential: true,
    dueDays: 45,
    certificate: false,
    validityMonths: null,
    courses: ['welcome', 'selling', 'service'],
  },
];

/** Questions and answers learners post on lessons. `answer` is the instructor’s reply, if any. */
export const THREADS = [
  { lesson: 'sec-phishing', by: 'l3', body: 'If a text claims to be from our bank about the company card, should that also go to security@ or to the bank?', answer: { by: 'aisha', body: 'Both, please — forward it to security@ first so we can warn others, then contact the bank using the number on the back of the card. Never the number in the text.' }, daysAgo: 12 },
  { lesson: 'sec-passwords', by: 'l8', body: 'Is it okay to save work passwords in Chrome instead of 1Password?', answer: { by: 'aisha', body: 'Please use 1Password. Browser storage isn’t tied to your Okta account, so we can’t revoke it if a laptop is lost.' }, daysAgo: 30, pinned: true },
  { lesson: 'sec-quiz', by: 'l14', body: 'Question 5 — does it accept the full address or only "security"? I typed the full address and it marked me correct, just checking that’s intended.', answer: null, daysAgo: 1 },
  { lesson: 'wh-lifting', by: 'l20', body: 'The lift assists in aisle 14 have been broken for a week. Who do I tell?', answer: { by: 'tom', body: 'Thanks for flagging — I’ve opened a work order and they’ll be fixed tomorrow. For anything like this, log it in the EHS app so it’s tracked.' }, daysAgo: 6 },
  { lesson: 'wh-report', by: 'l22', body: 'Can the hazard be something I already fixed? I moved a pallet that was blocking the eyewash station.', answer: null, daysAgo: 2 },
  { lesson: 'wh-forklift', by: 'l19', body: 'Are the green walkway rules the same on night shift when the floor is quieter?', answer: null, daysAgo: 0 },
  { lesson: 'fb-sbi', by: 'l27', body: 'How do you give SBI feedback to your own manager? It feels awkward.', answer: { by: 'maya', body: 'Same shape, and ask permission first: "Can I share something from the planning meeting?" Most managers really appreciate it.' }, daysAgo: 9 },
  { lesson: 'oo-guide', by: 'l28', body: 'Any tips for 1:1s with people on rotating shifts? Weekly is hard to schedule.', answer: null, daysAgo: 3 },
  { lesson: 'svc-last', by: 'l10', body: 'What if a customer asks for more than $250 in credit?', answer: { by: 'daniel', body: 'Call your store lead — they can approve up to $1,000. Offer the customer a seat and a coffee while you do.' }, daysAgo: 20 },
  { lesson: 'wel-tools', by: 'l30', body: 'Where do I find my Workday login? I didn’t get the email.', answer: null, daysAgo: 1 },
  { lesson: 'sel-discovery', by: 'l16', body: 'Is SPIN still relevant for renewals, or only new accounts?', answer: { by: 'sofia', body: 'Very relevant — renewals are where implication questions shine. Try "What changed in your business this year?"' }, daysAgo: 15 },
];
