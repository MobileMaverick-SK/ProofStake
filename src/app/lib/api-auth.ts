import { currentUser } from '@/app/lib/session';
import { getApp } from '@/composition-root';
import { DomainError } from '@/core/shared';

/** For API routes: the signed-in user's own goal, or a thrown UNAUTHENTICATED / NOT_FOUND. */
export async function ownedGoal(goalId: string) {
  const user = await currentUser();
  if (!user) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
  return getApp().goals.getOwnedGoal(user.id, goalId);
}
