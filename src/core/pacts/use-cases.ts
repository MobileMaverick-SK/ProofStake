import { z } from 'zod';
import {
  DomainError,
  isDomainError,
  toDecimalString,
  type Clock,
  type EventBus,
  type Money,
  type ProofRules,
} from '../shared';
import type { Pact, PactRepository, Payouts } from './ports';

/** How long after a capture the user can still appeal before the partner is paid. Short, because this is a demo. */
export const DEFAULT_APPEAL_WINDOW_MS = 5 * 60 * 1000;
export const MAX_NUDGE_LENGTH = 140;

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);

const partnerSchema = z.object({
  partnerName: z.string().trim().min(1, "Enter your partner's name").max(60),
  partnerEmail: email,
});

export type PartnerInput = z.infer<typeof partnerSchema>;

/** Checks the partner details on their own, so a goal is not created and then left without its pact. */
export function validatePartner(input: { partnerName: string; partnerEmail: string }, ownerEmail: string): PartnerInput {
  const parsed = partnerSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION', parsed.error.issues.map((i) => i.message).join('; '));
  if (parsed.data.partnerEmail === ownerEmail.trim().toLowerCase()) {
    throw new DomainError('VALIDATION', 'Your pact partner must be someone else, with a different email address.');
  }
  return parsed.data;
}

export interface PactsDeps {
  pacts: PactRepository;
  payouts: Payouts;
  bus: EventBus;
  clock: Clock;
  appealWindowMs?: number;
}

export function createPactsUseCases({ pacts, payouts, bus, clock, appealWindowMs = DEFAULT_APPEAL_WINDOW_MS }: PactsDeps) {
  const sending = new Set<string>();

  async function byToken(token: string): Promise<Pact> {
    const pact = token ? await pacts.getByToken(token) : null;
    if (!pact) throw new DomainError('NOT_FOUND', 'This invite link is not valid.');
    return pact;
  }

  /** Changes a pact only if it exists; goals without a pact are the normal case. */
  async function update(goalId: string, change: (pact: Pact) => Pact | null): Promise<void> {
    const pact = await pacts.get(goalId);
    if (!pact) return;
    const changed = change(pact);
    if (changed) await pacts.save(changed);
  }

  const settled = (pact: Pact) => pact.outcome === 'KEPT' || pact.outcome === 'LOST' || pact.outcome === 'REFUNDED';

  return {
    appealWindowMs,

    async propose(input: {
      goalId: string;
      userId: string;
      ownerName: string;
      ownerEmail: string;
      partnerName: string;
      partnerEmail: string;
      goalText: string;
      deadline: Date;
      stake: Money;
    }): Promise<Pact> {
      const partner = validatePartner(input, input.ownerEmail);
      if (await pacts.get(input.goalId)) throw new DomainError('CONFLICT', 'This goal already has a pact');
      const pact: Pact = {
        goalId: input.goalId,
        userId: input.userId,
        ownerName: input.ownerName,
        ...partner,
        token: `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`.replaceAll('-', ''),
        goalText: input.goalText,
        deadline: input.deadline,
        stake: input.stake,
        status: 'INVITED',
        createdAt: clock.now(),
        outcome: 'PENDING',
      };
      await pacts.save(pact);
      return pact;
    },

    getForGoal: (goalId: string) => pacts.get(goalId),

    /** What the invite link shows. Throws NOT_FOUND for an unknown link. */
    getByToken: byToken,

    /** The partner agrees and says where to be paid. Possible until the goal is settled. */
    async accept(token: string, payoutEmail: string): Promise<Pact> {
      const pact = await byToken(token);
      if (pact.status === 'ACCEPTED') throw new DomainError('CONFLICT', 'You already accepted this pact.');
      if (settled(pact)) throw new DomainError('CONFLICT', 'This goal is already settled, so the pact can no longer be accepted.');
      const parsed = email.safeParse(payoutEmail);
      if (!parsed.success) throw new DomainError('VALIDATION', 'Enter the email address of your PayPal account.');
      const accepted: Pact = { ...pact, status: 'ACCEPTED', payoutEmail: parsed.data, respondedAt: clock.now() };
      await pacts.save(accepted);
      return accepted;
    },

    async decline(token: string): Promise<Pact> {
      const pact = await byToken(token);
      if (pact.status !== 'INVITED') throw new DomainError('CONFLICT', 'This invite was already answered.');
      const declined: Pact = { ...pact, status: 'DECLINED', respondedAt: clock.now() };
      await pacts.save(declined);
      return declined;
    },

    /** One short message of encouragement from the partner. It never affects the verdict. */
    async nudge(token: string, text: string): Promise<Pact> {
      const pact = await byToken(token);
      if (pact.status !== 'ACCEPTED') throw new DomainError('CONFLICT', 'Accept the pact before sending a message.');
      if (pact.nudge) throw new DomainError('CONFLICT', 'You already sent your message for this goal.');
      if (settled(pact)) throw new DomainError('CONFLICT', 'This goal is already settled.');
      const message = text.trim();
      if (message.length < 1 || message.length > MAX_NUDGE_LENGTH) {
        throw new DomainError('VALIDATION', `Write a message of up to ${MAX_NUDGE_LENGTH} characters.`);
      }
      const nudged: Pact = { ...pact, nudge: { text: message, at: clock.now() } };
      await pacts.save(nudged);
      return nudged;
    },

    // ---- reactions to what other modules announce ----

    onRulesAccepted: (goalId: string, rules: ProofRules) => update(goalId, (pact) => ({ ...pact, rules })),

    onStakeHeld: (goalId: string) => update(goalId, (pact) => ({ ...pact, outcome: 'HELD' })),

    onStakeReleased: (goalId: string) => update(goalId, (pact) => ({ ...pact, outcome: 'KEPT' })),

    /** A lost stake goes to the partner only if they accepted. Otherwise it stays in the charity pool. */
    onStakeCaptured: (goalId: string, amount: Money) =>
      update(goalId, (pact) => ({
        ...pact,
        outcome: 'LOST',
        payout:
          pact.status === 'ACCEPTED'
            ? { status: 'SCHEDULED', amount, dueAt: new Date(clock.now().getTime() + appealWindowMs) }
            : undefined,
      })),

    /** While an appeal is open the money stays where it is. */
    onAppealFiled: (goalId: string) =>
      update(goalId, (pact) =>
        pact.payout?.status === 'SCHEDULED' ? { ...pact, payout: { ...pact.payout, status: 'ON_HOLD' } } : null,
      ),

    onAppealRejected: (goalId: string) =>
      update(goalId, (pact) =>
        pact.payout?.status === 'ON_HOLD' ? { ...pact, payout: { ...pact.payout, status: 'SCHEDULED' } } : null,
      ),

    /** The user was refunded, so there is nothing to pay the partner. */
    onAppealUpheld: (goalId: string) =>
      update(goalId, (pact) => ({
        ...pact,
        outcome: 'REFUNDED',
        payout: pact.payout && pact.payout.status !== 'SENT' ? { ...pact.payout, status: 'CANCELLED' } : pact.payout,
      })),

    /**
     * Sends every payout whose appeal window has closed, and refreshes the
     * status of payouts already sent. Called by the scheduler; safe to call often.
     */
    async processPayouts(): Promise<void> {
      for (const listed of await pacts.listOpenPayouts()) {
        if (sending.has(listed.goalId)) continue;
        sending.add(listed.goalId);
        try {
          // Read again: an appeal may have changed the payout since the list was made.
          const pact = await pacts.get(listed.goalId);
          const payout = pact?.payout;
          if (!pact || !payout) continue;

          if (payout.status === 'SENT' && payout.payoutId) {
            const providerStatus = await payouts.getStatus(payout.payoutId).catch(() => payout.providerStatus);
            if (providerStatus !== payout.providerStatus) await pacts.save({ ...pact, payout: { ...payout, providerStatus } });
            continue;
          }
          if (payout.status !== 'SCHEDULED' || payout.dueAt.getTime() > clock.now().getTime() || !pact.payoutEmail) continue;

          try {
            const { payoutId } = await payouts.send({
              goalId: pact.goalId,
              amount: payout.amount,
              recipientEmail: pact.payoutEmail,
              note: `ProofStake pact with ${pact.ownerName}: $${toDecimalString(payout.amount)} from a missed goal.`,
            });
            await pacts.save({
              ...pact,
              payout: { ...payout, status: 'SENT', payoutId, sentAt: clock.now(), providerStatus: 'PROCESSING', lastError: undefined },
            });
            await bus.publish({ type: 'StakePaidOut', goalId: pact.goalId, payoutId, amount: payout.amount });
          } catch (error) {
            const message = isDomainError(error) ? error.message : 'The payout could not be sent. It will be tried again.';
            await pacts.save({ ...pact, payout: { ...payout, lastError: { at: clock.now(), message } } });
          }
        } finally {
          sending.delete(listed.goalId);
        }
      }
    },
  };
}
