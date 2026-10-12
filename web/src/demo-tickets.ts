import type { Ticket } from '../../shared/protocol.js';

/** Fictional examples for the ticket drawer; real tickets are shown first. */
const examples = [
  ['Printer has joined a union', 'It refuses to print until we negotiate toner breaks and a four-day paper week.'],
  ['Password reset requires the password I forgot', 'The security questions now ask why I am like this.'],
  ['My laptop has entered witness protection', 'It changed its name, disconnected from Wi-Fi, and refuses to discuss the spreadsheet.'],
  ['The cloud is raining on my files', 'All my documents are damp. Please advise whether this is covered by the service agreement.'],
  ['Spreadsheet keeps making financial decisions', 'Cell B12 purchased a boat. The quarterly forecast now includes marina fees.'],
  ['Smart fridge has performance feedback', 'It scheduled a meeting about my cheese consumption and invited HR.'],
  ['Mouse is moving without permission', 'The cat claims this is normal. The cat is also listed as the administrator.'],
  ['Calendar has booked me for yesterday', 'I am already late. Please escalate to someone with a time machine.'],
  ['Wi-Fi only works when I compliment it', 'Signal strength improves after I say it has excellent coverage and a nice personality.'],
  ['Update stuck at 99% since the Renaissance', 'The progress bar says just a moment. Several empires have fallen.'],
  ['Support hold music is now my inner monologue', 'I hear smooth jazz whenever I make a decision. Is there an unsubscribe button?'],
  ['Webcam thinks my houseplant is the manager', 'The fern keeps getting promoted. I have been asked to report to a succulent.'],
  ['Dark mode has become too literal', 'The screen is completely black. Apparently this is the premium darkness tier.'],
  ['My robot vacuum filed a grievance', 'It found crumbs outside its job description and wants mileage reimbursement.'],
  ['Two-factor authentication needs a third factor', 'My phone is asking for my other phone. That phone is asking for a small interpretive dance.'],
] as const;

const timestamp = Date.now();
export const DEMO_TICKETS: Ticket[] = examples.map(([summary, details], index) => ({
  id: `DEMO-${String(index + 1).padStart(3, '0')}`,
  summary,
  details,
  createdAt: new Date(timestamp - index * 17 * 60_000).toISOString(),
}));
