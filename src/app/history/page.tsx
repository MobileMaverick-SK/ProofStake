import { redirect } from 'next/navigation';

/** History is the "Finished" view of the goals list. Old links keep working. */
export default function HistoryPage() {
  redirect('/goals?show=finished');
}
