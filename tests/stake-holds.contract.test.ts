import { FakeStakeHolds } from '../src/adapters/fakes';
import { stakeHoldsContract } from './stake-holds.contract';

stakeHoldsContract('in-memory fake', () => {
  const holds = new FakeStakeHolds();
  return { holds, approve: async (orderId) => holds.approve(orderId) };
});
