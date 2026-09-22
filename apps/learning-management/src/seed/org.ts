/**
 * Fernwood Supply Co.: who works there, how they're grouped, who reports to
 * whom, and which assignment rules and live sessions the L&D team runs.
 *
 * Every seeded person uses a reserved example domain, which is how "Remove
 * demo data" tells them apart from real people added later.
 */

export const DEMO_ORG = {
  organizationName: 'Fernwood Supply Co.',
  academyName: 'Fernwood Academy',
  academyHeadline: 'Grow your skills at Fernwood',
  academyIntro: 'Required training, onboarding and courses to help you grow — all in one place. Pick up where you left off, or find something new in the catalog.',
  brandColor: '#2f7a55',
  supportEmail: 'learning@fernwood.example.com',
  websiteUrl: 'https://fernwood.example.com',
  emailSignature: 'The Learning & Development team\nFernwood Supply Co.',
  certificateSignatory: 'Maya Okafor',
  certificateSignatoryTitle: 'Head of People & Learning',
  timezone: 'America/Chicago',
};

export type SeedPerson = {
  key: string;
  name: string;
  title: string;
  role: 'Admin' | 'Instructor' | 'Learner';
  groups: string[];
  manager: string | null;
  hireDaysAgo: number;
  /** 0–1: how reliably this person finishes training on time. */
  diligence: number;
  status?: 'Active' | 'Invited' | 'Deactivated';
};

const email = (name: string) => `${name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@fernwood.example.com`;
export const emailFor = (p: Pick<SeedPerson, 'name'>) => email(p.name);

/** `me` is the admin who installed the template; their row already exists. */
export const PEOPLE: SeedPerson[] = [
  { key: 'maya', name: 'Maya Okafor', title: 'Head of People & Learning', role: 'Admin', groups: ['hq', 'leaders'], manager: 'me', hireDaysAgo: 2100, diligence: 0.95 },
  { key: 'daniel', name: 'Daniel Brooks', title: 'Learning Program Manager', role: 'Instructor', groups: ['hq'], manager: 'maya', hireDaysAgo: 1500, diligence: 0.9 },
  { key: 'sofia', name: 'Sofia Marín', title: 'Sales Enablement Lead', role: 'Instructor', groups: ['sales', 'hq'], manager: 'l15', hireDaysAgo: 900, diligence: 0.85 },
  { key: 'tom', name: 'Tom Whitaker', title: 'EHS Manager, Distribution Center', role: 'Instructor', groups: ['dc', 'leaders'], manager: 'l17', hireDaysAgo: 1800, diligence: 0.9 },
  { key: 'aisha', name: 'Aisha Rahman', title: 'Security & Compliance Lead', role: 'Instructor', groups: ['hq'], manager: 'maya', hireDaysAgo: 700, diligence: 0.97 },

  { key: 'l1', name: 'Grace Liu', title: 'Store Manager, Oak Park', role: 'Learner', groups: ['retail', 'leaders'], manager: 'l2', hireDaysAgo: 1300, diligence: 0.8 },
  { key: 'l2', name: 'Marcus Chen', title: 'Regional Operations Director', role: 'Learner', groups: ['hq', 'leaders'], manager: 'me', hireDaysAgo: 2400, diligence: 0.55 },
  { key: 'l3', name: 'Priya Natarajan', title: 'Assistant Store Manager, Oak Park', role: 'Learner', groups: ['retail'], manager: 'l1', hireDaysAgo: 640, diligence: 0.92 },
  { key: 'l4', name: 'Jamal Carter', title: 'Sales Associate, Oak Park', role: 'Learner', groups: ['retail', 'newhires'], manager: 'l1', hireDaysAgo: 10, diligence: 0.75 },
  { key: 'l5', name: 'Elena Petrova', title: 'Sales Associate, Oak Park', role: 'Learner', groups: ['retail'], manager: 'l1', hireDaysAgo: 420, diligence: 0.35 },
  { key: 'l6', name: 'Owen Gallagher', title: 'Store Manager, Evanston', role: 'Learner', groups: ['retail', 'leaders'], manager: 'l2', hireDaysAgo: 980, diligence: 0.45 },
  { key: 'l7', name: 'Keiko Tanaka', title: 'Sales Associate, Evanston', role: 'Learner', groups: ['retail'], manager: 'l6', hireDaysAgo: 300, diligence: 0.88 },
  { key: 'l8', name: 'Luis Ramírez', title: 'Sales Associate, Evanston', role: 'Learner', groups: ['retail'], manager: 'l6', hireDaysAgo: 520, diligence: 0.6 },
  { key: 'l9', name: 'Hannah Weiss', title: 'Visual Merchandiser, Evanston', role: 'Learner', groups: ['retail', 'newhires'], manager: 'l6', hireDaysAgo: 20, diligence: 0.9 },
  { key: 'l10', name: 'Tariq Hassan', title: 'Customer Service Lead, Evanston', role: 'Learner', groups: ['retail'], manager: 'l6', hireDaysAgo: 760, diligence: 0.83 },
  { key: 'l11', name: 'Chloe Martin', title: 'Account Executive', role: 'Learner', groups: ['sales', 'newhires'], manager: 'l15', hireDaysAgo: 15, diligence: 0.85 },
  { key: 'l12', name: 'Arjun Mehta', title: 'Sales Development Representative', role: 'Learner', groups: ['sales'], manager: 'l15', hireDaysAgo: 230, diligence: 0.5 },
  { key: 'l13', name: 'Fatima Zahra', title: 'Support Team Lead', role: 'Learner', groups: ['support', 'leaders'], manager: 'l2', hireDaysAgo: 1100, diligence: 0.9 },
  { key: 'l14', name: 'Isaac Levi', title: 'Support Specialist', role: 'Learner', groups: ['support'], manager: 'l13', hireDaysAgo: 360, diligence: 0.7 },
  { key: 'l15', name: 'Rachel Adeyemi', title: 'VP, Commercial Sales', role: 'Learner', groups: ['sales', 'hq', 'leaders'], manager: 'me', hireDaysAgo: 1600, diligence: 0.65 },
  { key: 'l16', name: 'Ben Harrington', title: 'Senior Account Executive', role: 'Learner', groups: ['sales'], manager: 'l15', hireDaysAgo: 870, diligence: 0.78 },
  { key: 'l17', name: 'Rosa Delgado', title: 'Distribution Center General Manager', role: 'Learner', groups: ['dc', 'leaders'], manager: 'l2', hireDaysAgo: 1900, diligence: 0.87 },
  { key: 'l18', name: 'Kwame Mensah', title: 'Shift Supervisor', role: 'Learner', groups: ['dc', 'leaders'], manager: 'l17', hireDaysAgo: 690, diligence: 0.72 },
  { key: 'l19', name: 'Brandon Kowalski', title: 'Forklift Operator', role: 'Learner', groups: ['dc'], manager: 'l18', hireDaysAgo: 450, diligence: 0.4 },
  { key: 'l20', name: 'Mei Wong', title: 'Order Picker', role: 'Learner', groups: ['dc'], manager: 'l18', hireDaysAgo: 330, diligence: 0.93 },
  { key: 'l21', name: 'Diego Alvarez', title: 'Receiving Associate', role: 'Learner', groups: ['dc', 'newhires'], manager: 'l18', hireDaysAgo: 6, diligence: 0.7 },
  { key: 'l22', name: 'Nadia Popescu', title: 'Inventory Control Specialist', role: 'Learner', groups: ['dc'], manager: 'l17', hireDaysAgo: 580, diligence: 0.86 },
  { key: 'l23', name: 'Samuel Okonkwo', title: 'Order Picker', role: 'Learner', groups: ['dc', 'newhires'], manager: 'l18', hireDaysAgo: 12, diligence: 0.8 },
  { key: 'l24', name: 'Lily Fischer', title: 'Shipping Associate', role: 'Learner', groups: ['dc'], manager: 'l18', hireDaysAgo: 210, diligence: 0.3 },
  { key: 'l25', name: 'Zoe Bennett', title: 'Support Specialist', role: 'Learner', groups: ['support'], manager: 'l13', hireDaysAgo: 150, diligence: 0.88 },
  { key: 'l26', name: 'Omar Farouk', title: 'Support Specialist', role: 'Learner', groups: ['support', 'newhires'], manager: 'l13', hireDaysAgo: 25, diligence: 0.6 },
  { key: 'l27', name: 'Julia Novak', title: 'Finance Manager', role: 'Learner', groups: ['hq', 'leaders'], manager: 'me', hireDaysAgo: 1250, diligence: 0.7 },
  { key: 'l28', name: 'Ethan Park', title: 'Merchandising Manager', role: 'Learner', groups: ['hq', 'leaders'], manager: 'me', hireDaysAgo: 540, diligence: 0.58 },
  { key: 'l29', name: 'Sara Lindqvist', title: 'Marketing Coordinator', role: 'Learner', groups: ['hq'], manager: 'l28', hireDaysAgo: 190, diligence: 0.9 },
  { key: 'l30', name: 'Victor Huang', title: 'Data Analyst', role: 'Learner', groups: ['hq', 'newhires'], manager: 'l27', hireDaysAgo: 4, diligence: 0.8 },
  { key: 'l31', name: 'Amara Nwosu', title: 'HR Business Partner', role: 'Learner', groups: ['hq'], manager: 'maya', hireDaysAgo: 410, diligence: 0.96 },
  { key: 'l32', name: 'Peter Sørensen', title: 'IT Support Specialist', role: 'Learner', groups: ['hq'], manager: 'aisha', hireDaysAgo: 270, diligence: 0.82 },
  { key: 'l33', name: 'Noah Williams', title: 'Sales Associate, Oak Park', role: 'Learner', groups: ['retail'], manager: 'l1', hireDaysAgo: 0, diligence: 0.5, status: 'Invited' },
  { key: 'l34', name: 'Carmen Ortiz', title: 'Order Picker', role: 'Learner', groups: ['dc'], manager: 'l18', hireDaysAgo: 800, diligence: 0.6, status: 'Deactivated' },
];

export const GROUPS = [
  { key: 'retail', name: 'Retail Stores', kind: 'Department', color: '#a4445c', owner: 'l2', description: 'Store managers, associates and service leads across our Chicago-area stores.' },
  { key: 'dc', name: 'Distribution Center', kind: 'Department', color: '#a8730f', owner: 'l17', description: 'Everyone working at the Joliet distribution center.' },
  { key: 'sales', name: 'Commercial Sales', kind: 'Department', color: '#2f6b55', owner: 'l15', description: 'Account executives and SDRs serving business customers.' },
  { key: 'support', name: 'Customer Support', kind: 'Department', color: '#1d6f78', owner: 'l13', description: 'Phone, chat and email support.' },
  { key: 'hq', name: 'Chicago HQ', kind: 'Location', color: '#5b5650', owner: null, description: 'Headquarters teams.' },
  { key: 'leaders', name: 'People Leaders', kind: 'Team', color: '#2e4a70', owner: 'maya', description: 'Anyone with direct reports. Managed by the People team.' },
  { key: 'newhires', name: 'New Hires · Fall 2026', kind: 'Cohort', color: '#5f7a2c', owner: 'daniel', description: 'People who joined this autumn. Graduates move out after 30 days.' },
];

export type SeedRule = {
  key: string;
  name: string;
  targetType: 'Course' | 'Path';
  target: string;
  audience: 'Everyone' | 'Groups';
  groups: string[];
  dueDays: number;
  recurrenceMonths: number | null;
  status: 'Active' | 'Paused';
  createdBy: string;
  launchedDaysAgo: number;
};

export const RULES: SeedRule[] = [
  { key: 'r-security', name: 'Annual security awareness', targetType: 'Course', target: 'security', audience: 'Everyone', groups: [], dueDays: 30, recurrenceMonths: 12, status: 'Active', createdBy: 'aisha', launchedDaysAgo: 400 },
  { key: 'r-conduct', name: 'Code of Conduct acknowledgment', targetType: 'Course', target: 'conduct', audience: 'Everyone', groups: [], dueDays: 30, recurrenceMonths: 12, status: 'Active', createdBy: 'maya', launchedDaysAgo: 40 },
  { key: 'r-onboarding', name: 'New hire onboarding', targetType: 'Path', target: 'onboarding', audience: 'Groups', groups: ['newhires'], dueDays: 30, recurrenceMonths: null, status: 'Active', createdBy: 'daniel', launchedDaysAgo: 60 },
  { key: 'r-managers', name: 'Manager Essentials for people leaders', targetType: 'Path', target: 'managers', audience: 'Groups', groups: ['leaders'], dueDays: 60, recurrenceMonths: null, status: 'Active', createdBy: 'maya', launchedDaysAgo: 50 },
  { key: 'r-dc', name: 'Distribution center certification', targetType: 'Path', target: 'dc', audience: 'Groups', groups: ['dc'], dueDays: 14, recurrenceMonths: 12, status: 'Active', createdBy: 'tom', launchedDaysAgo: 200 },
  { key: 'r-respect', name: 'Respect at Work (every two years)', targetType: 'Course', target: 'respect', audience: 'Everyone', groups: [], dueDays: 45, recurrenceMonths: 24, status: 'Paused', createdBy: 'maya', launchedDaysAgo: 250 },
];

/** Direct assignments made by instructors, outside rules. */
export const ASSIGNMENTS = [
  { course: 'selling', groups: ['sales'], by: 'sofia', daysAgo: 35, dueDays: 30 },
  { course: 'service', groups: ['retail', 'support'], by: 'daniel', daysAgo: 25, dueDays: 21 },
];

/** Catalog courses people chose for themselves. */
export const SELF_ENROLLED = [
  { course: 'wellbeing', people: ['me', 'l3', 'l7', 'l14', 'l20', 'l25', 'l29', 'l31', 'l22'], daysAgo: 70 },
  { course: 'feedback', people: ['l3', 'l10', 'l16'], daysAgo: 45 },
  { course: 'oneonones', people: ['l10', 'l22'], daysAgo: 30 },
  { course: 'welcome', people: ['l29', 'l25'], daysAgo: 150 },
];

export type SeedSession = {
  key: string;
  title: string;
  course: string | null;
  lesson: string | null;
  description: string;
  /** Negative = in the past. */
  startsInDays: number;
  hour: number;
  minutes: number;
  location: string;
  meetingUrl: string | null;
  recordingUrl: string | null;
  capacity: number | null;
  instructor: string;
  status: 'Scheduled' | 'Cancelled';
  registrants: Array<{ person: string; status: 'Registered' | 'Waitlisted' | 'Attended' | 'Absent' | 'Cancelled' }>;
};

export const SESSIONS: SeedSession[] = [
  {
    key: 's-breakfast-next',
    title: 'New hire welcome breakfast',
    course: 'welcome',
    lesson: 'wel-live',
    description: 'Coffee, pastries and a Q&A with our co-founders. Bring a question about anything.',
    startsInDays: 5,
    hour: 14,
    minutes: 60,
    location: 'Chicago HQ, 4th floor kitchen',
    meetingUrl: null,
    recordingUrl: null,
    capacity: 20,
    instructor: 'daniel',
    status: 'Scheduled',
    registrants: [{ person: 'l4', status: 'Registered' }, { person: 'l9', status: 'Registered' }, { person: 'l11', status: 'Registered' }, { person: 'l30', status: 'Registered' }],
  },
  {
    key: 's-breakfast-past',
    title: 'New hire welcome breakfast',
    course: 'welcome',
    lesson: 'wel-live',
    description: 'Coffee, pastries and a Q&A with our co-founders.',
    startsInDays: -26,
    hour: 14,
    minutes: 60,
    location: 'Chicago HQ, 4th floor kitchen',
    meetingUrl: null,
    recordingUrl: null,
    capacity: 20,
    instructor: 'daniel',
    status: 'Scheduled',
    registrants: [{ person: 'l26', status: 'Attended' }, { person: 'l29', status: 'Attended' }, { person: 'l25', status: 'Absent' }],
  },
  {
    key: 's-difficult',
    title: 'Live Q&A: Handling difficult customers',
    course: 'service',
    lesson: 'svc-live',
    description: 'Bring your toughest real examples from the floor or the phones. We’ll role-play a few and share what works.',
    startsInDays: 2,
    hour: 20,
    minutes: 45,
    location: 'Zoom',
    meetingUrl: 'https://zoom.us/j/5550100200',
    recordingUrl: null,
    capacity: null,
    instructor: 'daniel',
    status: 'Scheduled',
    registrants: ['l3', 'l5', 'l7', 'l8', 'l10', 'l14', 'l25', 'l26'].map(p => ({ person: p, status: 'Registered' as const })),
  },
  {
    key: 's-lab-past',
    title: 'Feedback practice lab',
    course: 'feedback',
    lesson: 'fb-lab',
    description: 'Practise SBI feedback in small groups with a facilitator.',
    startsInDays: -12,
    hour: 16,
    minutes: 60,
    location: 'Chicago HQ, Room 3B',
    meetingUrl: 'https://zoom.us/j/5550100300',
    recordingUrl: 'https://zoom.us/rec/share/feedback-lab-demo',
    capacity: 12,
    instructor: 'maya',
    status: 'Scheduled',
    registrants: [{ person: 'l1', status: 'Attended' }, { person: 'l13', status: 'Attended' }, { person: 'l17', status: 'Attended' }, { person: 'l18', status: 'Absent' }, { person: 'l27', status: 'Attended' }, { person: 'me', status: 'Attended' }],
  },
  {
    key: 's-lab-next',
    title: 'Feedback practice lab',
    course: 'feedback',
    lesson: 'fb-lab',
    description: 'Practise SBI feedback in small groups with a facilitator.',
    startsInDays: 19,
    hour: 16,
    minutes: 60,
    location: 'Chicago HQ, Room 3B',
    meetingUrl: 'https://zoom.us/j/5550100301',
    recordingUrl: null,
    capacity: 12,
    instructor: 'maya',
    status: 'Scheduled',
    registrants: [{ person: 'l6', status: 'Registered' }, { person: 'l28', status: 'Registered' }, { person: 'l2', status: 'Registered' }],
  },
  {
    key: 's-forklift',
    title: 'Forklift practical assessment',
    course: 'warehouse',
    lesson: null,
    description: 'Hands-on assessment with a certified trainer. Wear safety shoes and bring your badge.',
    startsInDays: 9,
    hour: 13,
    minutes: 120,
    location: 'Joliet DC, training yard (Dock 2)',
    meetingUrl: null,
    recordingUrl: null,
    capacity: 6,
    instructor: 'tom',
    status: 'Scheduled',
    registrants: [{ person: 'l19', status: 'Registered' }, { person: 'l21', status: 'Registered' }, { person: 'l23', status: 'Registered' }, { person: 'l24', status: 'Registered' }, { person: 'l20', status: 'Registered' }, { person: 'l22', status: 'Registered' }, { person: 'l18', status: 'Waitlisted' }],
  },
  {
    key: 's-roleplay',
    title: 'Discovery call role-play',
    course: 'selling',
    lesson: null,
    description: 'Paired role-play of a discovery call with feedback from the enablement team.',
    startsInDays: 16,
    hour: 17,
    minutes: 90,
    location: 'Zoom',
    meetingUrl: 'https://zoom.us/j/5550100400',
    recordingUrl: null,
    capacity: 10,
    instructor: 'sofia',
    status: 'Cancelled',
    registrants: [{ person: 'l12', status: 'Cancelled' }, { person: 'l16', status: 'Cancelled' }],
  },
];

export const FEEDBACK_BANK = [
  'Clear and specific — exactly what we’re looking for. Nice work.',
  'Great detail on the location. Next time add who could be affected; it helps us prioritise.',
  'Solid structure. Your fix is practical and we’ve passed it to facilities.',
  'Really thoughtful. The follow-up question at the end is a great touch.',
  'Good start. Try making the behavior more observable — describe what they did, not what they meant.',
  'Excellent. I’d love to use this as an example in the next cohort, if you’re okay with that.',
];

/** Written reviews per course, each used at most once so no two learners say the same thing. */
export const REVIEWS: Record<string, string[]> = {
  security: [
    'Short and to the point. The real phishing examples were really useful.',
    'I reported a fake invoice email the week after taking this. Worth the half hour.',
    'The passphrase section finally convinced me to set up 1Password properly.',
    'Good refresher. The quiz questions were trickier than I expected.',
    'Would love a version with examples from the store tills.',
  ],
  conduct: [
    'Clear about gifts from suppliers, which is the question I actually get.',
    'Helpful to know the Speak Up line is anonymous — I didn’t realise.',
    'The scenarios made the Code feel less like a legal document.',
    'A lot of reading in the PDF, but the summary lessons are good.',
  ],
  respect: [
    'Handled a hard topic without being preachy.',
    'The “what would you do” scenarios started a real conversation on my team.',
    'Short, human and practical.',
    'I’d like a follow-up on bystander situations in group chats.',
  ],
  welcome: [
    'The first-week checklist saved me a lot of asking around.',
    'Loved the history of the company — it made the stores make sense.',
    'Practical and friendly. Knowing who to ask for what was the best part.',
    'Wish I’d had this before my first day rather than during it.',
  ],
  warehouse: [
    'The hazard spotting exercise was the most useful part.',
    'Good mix of rules and real photos from the Joliet floor.',
    'Clear on the green walkway rules. The practical assessment is a good idea.',
    'A bit long, but it covers everything the EHS team checks.',
  ],
  selling: [
    'The discovery question bank is gold. I used three of them on my next call.',
    'Made me talk less and listen more on calls.',
    'Would love more examples from commercial accounts.',
  ],
  service: [
    'The LAST method is simple enough to actually remember at the counter.',
    'Role-play scripts were spot on for returns without a receipt.',
    'Good, but I’d add a section on phone calls.',
    'Calm, practical advice for difficult moments.',
  ],
  feedback: [
    'SBI is so simple I’m surprised nobody taught it to me before.',
    'The written exercise with a real example made it stick.',
    'Clear, practical and I actually learned something.',
    'The follow-up question part changed how my 1:1s go.',
  ],
  oneonones: [
    'The agenda template is now pinned in every 1:1 doc I have.',
    'Useful reminder that the 1:1 belongs to the report, not me.',
    'Short and practical. The puzzle of motivation lesson was great.',
  ],
  wellbeing: [
    'The energy audit was more eye-opening than I expected.',
    'Good, grounded advice — no toxic positivity.',
    'The procrastination section was very relatable.',
    'One of the better trainings we’ve had.',
  ],
};

